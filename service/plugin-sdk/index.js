'use strict'

const TOOL_METADATA = Symbol.for('@chatgpt-web/plugin-sdk/llm-tool')
const BASE_PLUGIN_METADATA = Symbol.for('@chatgpt-web/plugin-sdk/base-plugin')

function llmTool(definition) {
  return (targetOrMethod, propertyKeyOrContext, descriptor) => {
    if (typeof targetOrMethod === 'function'
      && propertyKeyOrContext
      && typeof propertyKeyOrContext === 'object'
      && propertyKeyOrContext.kind === 'method') {
      Object.defineProperty(targetOrMethod, TOOL_METADATA, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: Object.freeze({ ...definition }),
      })
      return targetOrMethod
    }

    if (!descriptor || typeof descriptor.value !== 'function')
      throw new TypeError(`@llmTool can only decorate methods (${String(propertyKeyOrContext)})`)

    Object.defineProperty(descriptor.value, TOOL_METADATA, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({ ...definition }),
    })
  }
}

class BasePlugin {
  getTools() {
    const tools = []
    const visitedMethods = new Set()
    let prototype = Object.getPrototypeOf(this)

    while (prototype && prototype !== BasePlugin.prototype) {
      for (const propertyKey of Object.getOwnPropertyNames(prototype)) {
        if (propertyKey === 'constructor' || visitedMethods.has(propertyKey))
          continue
        visitedMethods.add(propertyKey)

        const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyKey)
        const method = descriptor && descriptor.value
        const definition = method && method[TOOL_METADATA]
        if (!definition)
          continue

        tools.push({
          ...definition,
          methodName: propertyKey,
          execute: method.bind(this),
        })
      }
      prototype = Object.getPrototypeOf(prototype)
    }

    return tools
  }
}

Object.defineProperty(BasePlugin.prototype, BASE_PLUGIN_METADATA, {
  configurable: false,
  enumerable: false,
  writable: false,
  value: true,
})

function isBasePluginClass(value) {
  return typeof value === 'function' && Boolean(value.prototype && value.prototype[BASE_PLUGIN_METADATA])
}

module.exports = {
  BasePlugin,
  isBasePluginClass,
  llmTool,
}

const controllerMap = new Map<number, AbortController>()

/** 为指定 uuid 创建新控制器（会先中止已存在的） */
export function createController(uuid: number): AbortController {
  const existing = controllerMap.get(uuid)
  if (existing)
    existing.abort()
  const ctrl = new AbortController()
  controllerMap.set(uuid, ctrl)
  return ctrl
}

/** 中止并移除指定 uuid 的控制器 */
export function abortController(uuid: number): void {
  const ctrl = controllerMap.get(uuid)
  if (ctrl) {
    ctrl.abort()
    controllerMap.delete(uuid)
  }
}

/** 检查指定 uuid 是否有活跃的控制器 */
export function hasController(uuid: number): boolean {
  return controllerMap.has(uuid)
}

/** 移除指定 uuid 的控制器（不中止） */
export function removeController(uuid: number): void {
  controllerMap.delete(uuid)
}

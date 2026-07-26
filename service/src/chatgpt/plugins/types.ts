export interface ToolPlugin {
  /**
   * The name of the function to be called. Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64.
   */
  name: string
  /**
   * A description of what the function does, used by the model to choose when and how to call the function.
   */
  description: string
  /**
   * The parameters the functions accepts, described as a JSON Schema object.
   */
  parameters: Record<string, any>
  /**
   * The function execution logic.
   */
  execute: (args: Record<string, any>, context?: any) => Promise<string>
}

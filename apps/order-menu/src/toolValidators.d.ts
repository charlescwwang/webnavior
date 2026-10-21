declare module 'virtual:menu-tool-validators' {
  import type { ValidateFunction } from 'ajv'

  const validators: Record<string, ValidateFunction>
  export default validators
}

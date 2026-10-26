/**
 * demo 用的全局状态(window.__guardLog 由守卫写入、面板渲染)
 */
export {}

declare global {
  interface Window {
    __guardLog: string
  }
}
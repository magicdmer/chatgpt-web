export async function copyToClip(text: string): Promise<string> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return text
    }
    catch (error) {
      // 权限或浏览器策略拒绝时继续使用兼容方案
    }
  }

  const input = document.createElement('textarea')
  input.value = text
  input.setAttribute('readonly', 'readonly')
  input.style.position = 'fixed'
  input.style.left = '-9999px'
  input.style.opacity = '0'
  document.body.appendChild(input)

  try {
    input.focus()
    input.select()
    input.setSelectionRange(0, input.value.length)
    if (!document.execCommand('copy'))
      throw new Error('Copy command was rejected')
    return text
  }
  finally {
    document.body.removeChild(input)
  }
}

export function makeButton(iconName: string, title: string): HTMLButtonElement {
  const icon = makeIcon(iconName, title)
  icon.style.removeProperty('vertical-align')
  const button = document.createElement('button')
  button.appendChild(icon)
  button.classList.add('picea')
  button.style.all = 'unset'
  button.style.maxWidth = button.style.maxHeight = '32px'
  button.style.verticalAlign = 'middle'
  return button
}

export function makeIcon(name: string, title: string): HTMLImageElement {
  const icon = document.createElement('img')
  icon.classList.add('picea', `picea-icon-${name}`)
  icon.width = icon.height = 20
  icon.title = title
  icon.src = chrome.runtime.getURL(`resources/${name}.svg`)
  icon.style.verticalAlign = 'middle'
  return icon
}

export function purgeOldElements() {
  document.querySelectorAll('.picea').forEach(el => el.remove())
}

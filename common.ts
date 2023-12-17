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

export function purgePiceaElements() {
  document.querySelectorAll('.picea').forEach(el => el.remove())
}

function urlFor(path: string, base: string): URL {
  const url = new URL(path, base)
  url.protocol = 'https'
  return url
}

export async function fetchDocument(url: string): Promise<Document> {
  console.log('fetching ', url)
  const response = await fetch(urlFor(url, document.location.href))
  const html = await response.text()
  return new DOMParser().parseFromString(html, 'text/html')
}

export function toEpubString(date: Date): string {
  const copy = new Date(date)
  copy.setUTCMilliseconds(0)
  return copy.toISOString().replace(/\.000Z$/, 'Z')
}

export async function getTextResource(resource: string): Promise<string> {
  return await (await fetch(chrome.runtime.getURL(resource))).text()
}

export async function getBlobResource(resource: string): Promise<Blob> {
  return await (await fetch(chrome.runtime.getURL(resource))).blob()
}

export async function getImageDimensions(url: string) {
  return await new Promise<{ width: number; height: number }>(
    (resolve, reject) => {
      const img = new Image()
      img.onload = () =>
        resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = e => {
        console.log('image bad', e)
        reject(e)
      }
      img.src = new URL(url, document.location.href).href
    }
  )
}

export async function downloadImage(url: string): Promise<Blob> {
  console.log('fetching ', url)
  return (await fetch(urlFor(url, document.location.href))).blob()
}
export function titleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, s => s.toUpperCase())
}
export function timeout(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

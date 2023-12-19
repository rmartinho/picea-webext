export async function fetchDocument(url: string): Promise<Document> {
  console.log('fetching ', url)
  const response = await fetch(urlFor(url, document.location.href))
  const html = await response.text()
  return new DOMParser().parseFromString(html, 'text/html')
}

export async function fetchImage(url: string): Promise<Blob> {
  console.log('fetching ', url)
  return (await fetch(urlFor(url, document.location.href))).blob()
}

export async function fetchImageDimensions(url: string) {
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

export async function fetchTextResource(resource: string): Promise<string> {
  return await (await fetch(chrome.runtime.getURL(resource))).text()
}

export async function fetchBlobResource(resource: string): Promise<Blob> {
  return await (await fetch(chrome.runtime.getURL(resource))).blob()
}

function urlFor(path: string, base: string): URL {
  const url = new URL(path, base)
  url.protocol = 'https'
  return url
}

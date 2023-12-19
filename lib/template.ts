import ejs from 'ejs'
import { fetchTextResource } from './fetch'

export async function renderXHTMLTemplate(
  resource: string,
  options: object
): Promise<string> {
  const html = await renderTextTemplate(resource, options)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return new XMLSerializer().serializeToString(doc)
}

export async function renderTextTemplate(
  resource: string,
  options: object = {}
): Promise<string> {
  const template = await fetchTextResource(resource)
  return ejs.render(template, options, {
    includer: (path: string) => {
      return { template: includes[path] }
    },
  })
}
const includes: Record<string, string> = {}
export async function loadPartialTemplate(
  name: string,
  resource: string
): Promise<void> {
  includes[name] = await fetchTextResource(resource)
}

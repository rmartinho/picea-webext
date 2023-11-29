import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import ejs from 'ejs'

type Issue = {
  number: number
  month: string
  coverUrl: string
  cover: Blob
  sections: Section[]
  images: Blob[]
  element: HTMLElement
}

type Section = {
  title: string
  stories: Story[]
}

type Story = {
  url: string
  title: string
  author: string
  text: string
  element: HTMLElement
}

markAll()

function makeIcon(name: string, title: string): HTMLImageElement {
  const icon = document.createElement('img')
  icon.className = `clarkesreader-icon-${name}`
  icon.width = icon.height = 20
  icon.title = title
  icon.src = chrome.runtime.getURL(`resources/${name}.svg`)
  icon.style.verticalAlign = 'middle'
  return icon
}

function makeButton(iconName: string, title: string): HTMLButtonElement {
  const button = document.createElement('button')
  const icon = makeIcon(iconName, title)
  icon.style.removeProperty('vertical-align')
  button.appendChild(icon)
  button.style.all = 'unset'
  button.style.maxWidth = button.style.maxHeight = '32px'
  button.style.verticalAlign = 'middle'
  return button
}

function markAll() {
  const issues = parsePage(document)
  const button = makeButton('get-all', 'Download all EPUBs')
  button.addEventListener('click', async e => {
    if (!button.parentNode) return
    const icon = button.parentNode.appendChild(
      makeIcon('getting', 'Downloading EPUBs')
    )
    button.parentNode.removeChild(button)
    {
      for (const issue of issues) {
        try {
          await downloadIssue(issue)
        } catch (e) {
          icon.parentNode?.appendChild(
            makeIcon('error', 'Failed downloading EPUBs')
          )
          icon.parentNode?.removeChild(icon)
          throw e
        }
        await timeout(1000)
      }
    }
    icon.parentNode?.appendChild(button)
    icon.parentNode?.removeChild(icon)
  })
  document.querySelector('.content-section h1')?.appendChild(button)
}

function timeout(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function parsePage(doc: Document): Issue[] {
  const issues = [] as Issue[]
  const tables = doc.querySelectorAll('.issue-index')
  for (const el of tables) {
    const issue = parseIssue(el as HTMLElement)
    if (issue) {
      markIssue(el, issue)
      issues.push(issue)
    }
  }
  return issues
}

function parseIssue(element: HTMLElement): Issue | undefined {
  const title = element.querySelector('.issue a, .issue')?.textContent
  if (!title) return
  const [number, month] = title.replace('ISSUE ', '').split(' \u2013 ')

  const tables = element.querySelectorAll<HTMLElement>(
    '.index-table .index-table'
  )
  if (!tables) return
  const sections = [...tables].map(parseSection).filter(x => !!x) as Section[]

  const coverUrl = element.querySelector('.cover-image a')?.getAttribute('href')
  if (!coverUrl) return

  return {
    number: Number.parseInt(number, 10),
    month,
    sections,
    coverUrl,
    cover: new Blob(),
    images: [],
    element,
  }
}

function parseSection(el: HTMLElement): Section | undefined {
  const titleCaps = el.querySelector('.section')?.textContent
  if (!titleCaps) return
  const title = titleCase(titleCaps)

  const tables = el.querySelectorAll<HTMLElement>('.index-col1, .index-col2')
  if (!tables) return
  const stories = [...tables].map(parseStory).filter(x => !!x) as Story[]

  return {
    title,
    stories,
  }
}

function titleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, s => s.toUpperCase())
}

function parseStory(element: HTMLElement): Story | undefined {
  const anchor = element.querySelector('.story a')
  if (!anchor) return
  const title = anchor.textContent
  if (!title) return
  const url = anchor.getAttribute('href')
  if (!url) return

  const author = element.querySelector('.authorname')?.textContent
  if (!author) return
  return {
    title,
    author,
    url,
    text: '',
    element,
  }
}

function markIssue(el: Element, issue: Issue) {
  const issueEl = el.querySelector('.issue')

  const button = makeButton('get-epub', 'Download EPUB')
  button.addEventListener('click', e => downloadIssue(issue))
  issueEl?.appendChild(button)
}

async function downloadIssue(issue: Issue) {
  const button = issue.element.querySelector(
    '.clarkesreader-icon-get-epub'
  )?.parentElement
  if (!button) return
  const icon = button.parentNode?.appendChild(
    makeIcon('getting', 'Downloading EPUB')
  )
  button.parentNode?.removeChild(button)
  {
    try {
      await downloadCover(issue)
      for (const section of issue.sections) {
        for (const story of section.stories) {
          await downloadStory(issue, story)
          await timeout(100)
        }
      }
      await makeEpub(issue)
    } catch (e) {
      icon?.parentNode?.appendChild(
        makeIcon('error', 'Failed downloading EPUB')
      )
      icon?.parentNode?.removeChild(icon)
      throw e
    }
  }
  icon?.parentNode?.appendChild(button)
  icon?.parentNode?.removeChild(icon)
  issue.element
    .querySelectorAll('.clarkesreader-icon-get-story')
    .forEach(el => el.parentNode?.removeChild(el))
}

async function downloadCover(issue: Issue): Promise<Blob> {
  const response = await fetch(new URL(issue.coverUrl, document.location.href))
  const html = await response.text()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const src = doc.querySelector('.story-text img')?.getAttribute('src')
  if (!src) throw new Error('missing cover image')

  issue.cover = await downloadImage(src)
  return issue.cover
}

async function downloadImage(url: string): Promise<Blob> {
  return (await fetch(new URL(url, document.location.href))).blob()
}

async function downloadStory(issue: Issue, story: Story): Promise<string> {
  const icon = story.element
    .querySelector('.story')
    ?.appendChild(makeIcon('getting', 'Downloading story'))
  {
    const response = await fetch(new URL(story.url, document.location.href))
    const html = await response.text()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const award = doc.querySelector('p.award')
    const body = doc.querySelector('.story-text')
    if (!body) throw new Error('missing story body')
    body
      .querySelectorAll('.about, .about ~ div')
      .forEach(el => el.parentNode?.removeChild(el))
    body
      .querySelectorAll('.m-a-box-related, .addtoany_share_save_container')
      .forEach(el => el.parentNode?.removeChild(el))
    body.childNodes.forEach(el => {
      if (el.nodeType == Node.COMMENT_NODE && el.parentNode)
        el.parentNode?.removeChild(el)
    })
    const imgs = body.querySelectorAll('img')
    for (const img of imgs) {
      const src = img.getAttribute('src')
      if (!src) continue
      img.src = `image-${issue.images.length}.jpg` // TODO file extension
      const blob = await downloadImage(src)
      issue.images.push(blob)
    }
    body.querySelectorAll('a').forEach(a => {
      try {
        a.href = new URL(a.href, document.location.href).href
      } catch {}
    })
    body.querySelectorAll<HTMLElement>('p[align]').forEach(el => {
      try {
        const value = el.getAttribute('align')
        if (!value) return
        el.removeAttribute('align')
        el.style.textAlign = value
      } catch {}
    })
    story.text = (award?.outerHTML ?? '') + body.innerHTML
  }
  icon?.parentNode?.appendChild(makeIcon('get-story', 'Downloaded story'))
  icon?.parentNode?.removeChild(icon)

  return story.text
}

async function makeEpub(issue: Issue) {
  const zip = new JSZip()

  zip.file('mimetype', 'application/epub+zip')

  const metadataFile = 'content.opf'
  const containerTmpl = await getTextResource('resources/container.xml.ejs')
  const container = ejs.render(containerTmpl, { metadataFile })
  zip.file('META-INF/container.xml', container)

  var manifestEntries: {
    href: string
    id: string
    type: string
    properties?: string
  }[] = []
  var spineEntries: string[] = []
  var navEntries: {
    href: string
    text: string
  }[] = []
  var tocEntries: {
    title: string
    stories: (Story & {
      href: string
    })[]
  }[] = []

  const stylesheet = await getTextResource('resources/stylesheet.css')
  const styleFile = 'stylesheet.css'
  zip.file(styleFile, stylesheet)
  manifestEntries.push({ id: 'stylesheet', href: styleFile, type: 'text/css' })

  const sepImage = await getBlobResource('resources/sep.png')
  zip.file('sep.png', await sepImage.arrayBuffer(), { binary: true })
  manifestEntries.push({ id: 'sep', href: 'sep.png', type: 'image/png' })

  const coverImage = 'cover.jpg'
  zip.file(coverImage, await issue.cover.arrayBuffer(), { binary: true })
  manifestEntries.push({
    id: 'cover-image',
    href: coverImage,
    type: 'image/jpeg',
    properties: 'cover-image',
  })

  const coverTmpl = await getTextResource('resources/cover.xhtml.ejs')
  const coverHtml = ejs.render(coverTmpl, { coverImage })
  const coverPage = 'cover.xhtml'
  zip.file(coverPage, coverHtml)
  const coverId = 'cover'
  manifestEntries.push({
    id: coverId,
    href: coverPage,
    type: 'application/xhtml+xml',
    properties: 'calibre:title-page',
  })
  spineEntries.push(coverId)

  const tocPage = 'toc.xhtml'
  const tocId = 'toc'
  manifestEntries.push({
    id: tocId,
    href: tocPage,
    type: 'application/xhtml+xml',
  })
  spineEntries.push(tocId)

  var i = 0
  for (const blob of issue.images) {
    const imageFile = `image-${i}.jpg` // TODO file extension
    zip.file(imageFile, await blob.arrayBuffer(), { binary: true })
    manifestEntries.push({
      id: `image-${i}`,
      href: imageFile,
      type: blob.type,
    })
    i++
  }

  var i = 0
  for (const section of issue.sections) {
    const tocSectionEntry: (typeof tocEntries)[0] = {
      title: section.title,
      stories: [],
    }
    tocEntries.push(tocSectionEntry)
    for (const story of section.stories) {
      i++
      const filename = `story-${i}.xhtml`
      const textTmpl = await getTextResource('resources/story.xhtml.ejs')
      const textHtml = ejs.render(textTmpl, { stylefile: styleFile, story })
      const textDoc = new DOMParser().parseFromString(textHtml, 'text/html')
      const text = new XMLSerializer().serializeToString(textDoc)
      zip.file(filename, text)
      manifestEntries.push({
        id: `story-${i}`,
        href: filename,
        type: 'application/xhtml+xml',
      })
      spineEntries.push(`story-${i}`)
      navEntries.push({ href: filename, text: story.title })
      tocSectionEntry.stories.push({ href: filename, ...story })
    }
  }

  const tocTmpl = await getTextResource('resources/toc.xhtml.ejs')
  const tocHtml = ejs.render(tocTmpl, { stylefile: styleFile, tocEntries })
  zip.file(tocPage, tocHtml)

  const navTmpl = await getTextResource('resources/nav.xhtml.ejs')
  const navHtml = ejs.render(navTmpl, { coverPage, tocPage, navEntries })
  const navPage = 'nav.xhtml'
  zip.file(navPage, navHtml)
  manifestEntries.push({
    id: 'nav',
    href: navPage,
    type: 'application/xhtml+xml',
    properties: 'nav',
  })

  const metadataTmpl = await getTextResource('resources/content.opf.ejs')
  const metadata = ejs.render(metadataTmpl, {
    issue,
    id: crypto.randomUUID(),
    publishDate: toEpubString(new Date(`1 ${issue.month} 00:00:00 GMT+0000`)),
    modifyDate: toEpubString(new Date()),
    manifestEntries,
    spineEntries,
    coverPage,
    tocPage,
    startPage: 'story-1.xhtml',
  })
  zip.file(metadataFile, metadata)

  const blob = await zip.generateAsync({ type: 'blob' })
  saveAs(blob, `Clarkesworld #${issue.number} \u2013 ${issue.month}.epub`)
}

function toEpubString(date: Date): string {
  const copy = new Date(date)
  copy.setUTCMilliseconds(0)
  return copy.toISOString().replace(/\.000Z$/, 'Z')
}

async function getTextResource(resource: string): Promise<string> {
  return await (await fetch(chrome.runtime.getURL(resource))).text()
}
async function getBlobResource(resource: string): Promise<Blob> {
  return await (await fetch(chrome.runtime.getURL(resource))).blob()
}

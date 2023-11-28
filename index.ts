import JSZip from 'jszip'
import { saveAs } from 'file-saver'

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
    if (!button.parentElement) return
    const icon = button.parentElement.appendChild(makeIcon('getting', 'Downloading EPUBs'))
    button.parentElement.removeChild(button)
    {
      for (const issue of issues) {
        try {
          await downloadIssue(issue)
        } catch (e) {
          icon.parentElement?.appendChild(makeIcon('error', 'Failed downloading EPUBs'))
          icon.parentElement?.removeChild(icon)
          throw e
        }
        await timeout(1000)
      }
    }
    icon.parentElement?.appendChild(button)
    icon.parentElement?.removeChild(icon)
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
  const icon = button.parentElement?.appendChild(makeIcon('getting', 'Downloading EPUB'))
  button.parentElement?.removeChild(button)
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
      icon?.parentElement?.appendChild(makeIcon('error', 'Failed downloading EPUB'))
      icon?.parentElement?.removeChild(icon)
      throw e
    }
  }
  icon?.parentElement?.appendChild(button)
  icon?.parentElement?.removeChild(icon)
  issue.element
    .querySelectorAll('.clarkesreader-icon-get-story')
    .forEach(el => el.parentElement?.removeChild(el))
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
    const aboutStart = body.querySelector('.about')
    if (aboutStart) {
      body.querySelectorAll('.about, .about ~ div').forEach(el => {
        if (el.parentNode) el.parentNode.removeChild(el)
      })
    }
    body.childNodes.forEach(el => {
      if (el.nodeType == Node.COMMENT_NODE && el.parentNode)
        el.parentNode.removeChild(el)
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
  icon?.parentElement?.appendChild(makeIcon('get-story', 'Downloaded story'))
  icon?.parentElement?.removeChild(icon)

  return story.text
}

async function makeEpub(issue: Issue) {
  const zip = new JSZip()

  zip.file('mimetype', 'application/epub+zip')

  const container =
    '<?xml version="1.0"?>' +
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
    '  <rootfiles>' +
    '    <rootfile full-path="content.opf" media-type="application/oebps-package+xml" />' +
    '  </rootfiles>' +
    '</container>'
  zip.file('META-INF/container.xml', container)

  var manifestEntries = ''
  var spineEntries = ''
  var navEntries = ''
  var tocEntries = ''

  const stylesheet = await (
    await fetch(chrome.runtime.getURL('resources/stylesheet.css'))
  ).text()
  const stylefile = 'stylesheet.css'
  zip.file(stylefile, stylesheet)
  manifestEntries += `<item href="${stylefile}" id="css" media-type="text/css"/>`
  const sepImage = await (
    await fetch(chrome.runtime.getURL('resources/sep.png'))
  ).blob()
  zip.file('sep.png', await sepImage.arrayBuffer(), { binary: true })
  manifestEntries += `<item href="sep.png" id="sepimg" media-type="image/png"/>`

  const coverfile = 'cover.jpg'
  zip.file(coverfile, await issue.cover.arrayBuffer(), { binary: true })
  manifestEntries +=
    '<item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>'
  const titlepage =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">' +
    '  <head>' +
    '    <meta name="calibre:cover" content="true"/>' +
    '    <title>Cover</title>' +
    '    <style type="text/css" title="override_css">' +
    '      @page { padding: 0pt; margin: 0pt; }' +
    '      body { text-align: center; padding: 0pt; margin: 0pt; }' +
    '    </style>' +
    '  </head>' +
    '  <body>' +
    `    <img src="${coverfile}" />` +
    '  </body>' +
    '</html>'
  zip.file('titlepage.xhtml', titlepage)
  manifestEntries +=
    '<item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml" properties="calibre:title-page"/>'
  spineEntries += '<itemref idref="titlepage"/>'
  manifestEntries +=
    '<item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" />'
  spineEntries += '<itemref idref="toc"/>'

  var i = 0
  for (const blob of issue.images) {
    const imagefile = `image-${i}.jpg` // TODO file extension
    zip.file(imagefile, await blob.arrayBuffer(), { binary: true })
    manifestEntries += `<item id="image-${i}" href="${imagefile}" media-type="${blob.type}"/>`
    i++
  }

  var i = 0
  for (const section of issue.sections) {
    var first = true
    tocEntries += `<h3>${section.title}</h3>`
    for (const story of section.stories) {
      i++
      const filename = `story-${i}.xhtml`
      const textHtml =
        '<!DOCTYPE html>' +
        '<html lang="en">' +
        '  <head>' +
        `    <title>${story.title}</title>` +
        `    <link href="${stylefile}" rel="stylesheet" type="text/css"/>` +
        '  </head>' +
        '  <body>' +
        '    <div class="content-section">' +
        `      <h1 class="story-title balance-text wp-dark-mode-ignore">${story.title}</h1>` +
        `      <p class="story-author balance-text"><span class="byl">by</span> <span class="authorname">${story.author}</span></p>` +
        '      <div class="story-text">' +
        `${story.text}` +
        '      </div>' +
        '    </div>' +
        '  </body>' +
        '</html>'
      const textDoc = new DOMParser().parseFromString(textHtml, 'text/html')
      const text = new XMLSerializer().serializeToString(textDoc)
      zip.file(filename, text)
      manifestEntries += `<item id="story-${i}" href="${filename}" media-type="application/xhtml+xml"/>`
      spineEntries += `<itemref idref="story-${i}"/>`
      if (first) {
        navEntries += `<li><a href="${filename}">${section.title}</a><ol>`
        first = false
      }
      navEntries += `<li><a href="${filename}">${story.title}</a></li>`
      tocEntries += `<p><a href="${filename}">${story.title} by ${story.author}</a></p>`
    }
    navEntries += '</ol></li>'
  }

  const toc =
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' +
    '<!DOCTYPE html>' +
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">' +
    '  <head>' +
    '    <title>Table of Contents</title>' +
    `    <link href="${stylefile}" rel="stylesheet" type="text/css"/>` +
    '  </head>' +
    '  <body>' +
    '    <div class="content-section">' +
    '      <h1 class="story-title balance-text wp-dark-mode-ignore">Table of Contents</h1>' +
    '      <div class="story-text">' +
    `${tocEntries}` +
    '      </div>' +
    '    </div>' +
    '  </body>' +
    '</html>'
  zip.file('toc.xhtml', toc)

  const nav =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">' +
    '  <head>' +
    '    <title>Navigation</title>' +
    '    <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>' +
    '  </head>' +
    '  <body>' +
    '    <nav epub:type="toc">' +
    '      <ol>' +
    '        <li><a href="titlepage.xhtml">Cover</a></li>' +
    '        <li><a href="toc.xhtml">Contents</a></li>' +
    `${navEntries}` +
    '      </ol>' +
    '    </nav>' +
    '  </body>' +
    '</html>'
  zip.file('nav.xhtml', nav)
  manifestEntries +=
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'

  const publishDate = new Date(`1 ${issue.month} 00:00:00 GMT+0000`)
  const metadata =
    '<?xml version="1.0"?>' +
    '<package version="3.0" xml:lang="en" xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" prefix="calibre: https://calibre-ebook.com">' +
    '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `    <dc:identifier id="book-id">urn:uuid:${crypto.randomUUID()}</dc:identifier>` +
    '    <meta refines="#book-id" property="identifier-type" scheme="xsd:string">uuid</meta>' +
    `    <dc:title>Clarkesworld #${issue.number} \u2013 ${issue.month}</dc:title>` +
    '    <dc:language>en</dc:language>' +
    '    <dc:creator>Neil Clarke</dc:creator>' +
    `    <dc:date>${toEpubString(publishDate)}</dc:date>` +
    '    <meta property="belongs-to-collection" id="series-id">Clarkesworld Magazine</meta>' +
    '    <meta refines="#series-id" property="collection-type">series</meta>' +
    `    <meta refines="#series-id" property="group-position">${issue.number}</meta>` +
    `    <meta property="dcterms:modified" scheme="dcterms:W3CDTF">${toEpubString(
      new Date()
    )}</meta>` +
    '  </metadata>' +
    '  <manifest>' +
    `${manifestEntries}` +
    '  </manifest>' +
    '  <spine>' +
    `${spineEntries}` +
    '  </spine>' +
    '</package>'
  zip.file('content.opf', metadata)

  const blob = await zip.generateAsync({ type: 'blob' })
  saveAs(blob, `Clarkesworld #${issue.number} \u2013 ${issue.month}.epub`)
}

function toEpubString(date: Date): string {
  const copy = new Date(date)
  copy.setUTCMilliseconds(0)
  return copy.toISOString().replace(/\.000Z$/, 'Z')
}

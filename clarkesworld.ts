import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import mime from 'mime-types'
import {
  downloadImage,
  fetchDocument,
  getBlobResource,
  getImageDimensions,
  getTextResource,
  makeButton,
  makeIcon,
  purgePiceaElements,
  renderTextTemplate,
  renderXHTMLTemplate,
  timeout,
  titleCase,
  toEpubString,
} from './common'
import { Epub, FileHandle } from './epub'

type Issue = {
  number: number
  month: string
  coverUrl: string
  coverDimensions?: { height: number; width: number }
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

function markAll() {
  purgePiceaElements()

  const issues = parsePage(document)
  const button = makeButton('get-all', 'Download all EPUBs')
  button.addEventListener('click', async e => {
    if (!button.parentNode) return
    const icon = button.parentNode.appendChild(
      makeIcon('getting', 'Downloading EPUBs')
    )
    button.remove()
    {
      for (const issue of issues) {
        try {
          await downloadIssue(issue)
        } catch (e) {
          icon.parentNode?.appendChild(
            makeIcon('error', 'Failed downloading EPUBs')
          )
          icon.remove()
          throw e
        }
        await timeout(1000)
      }
    }
    icon.parentNode?.appendChild(button)
    icon.remove()
  })
  document.querySelector('.content-section h1')?.appendChild(button)
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
    '.picea-icon-get-epub'
  )?.parentElement
  if (!button) return
  const icon = button.parentNode?.appendChild(
    makeIcon('getting', 'Downloading EPUB')
  )
  button.remove()

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
    icon?.parentNode?.appendChild(makeIcon('error', 'Failed downloading EPUB'))
    icon?.remove()
    throw e
  }

  icon?.parentNode?.appendChild(button)
  icon?.remove()
  issue.element
    .querySelectorAll('.picea-icon-get-story')
    .forEach(el => el.remove())
}

async function downloadCover(issue: Issue): Promise<Blob> {
  const doc = await fetchDocument(issue.coverUrl)
  const src = doc.querySelector('.story-text img')?.getAttribute('src')
  if (!src) throw new Error('missing cover image')

  issue.cover = await downloadImage(src)
  issue.coverDimensions = await getImageDimensions(src)
  issue.coverUrl = src
  return issue.cover
}

async function downloadStory(issue: Issue, story: Story): Promise<string> {
  const icon = story.element
    .querySelector('.story')
    ?.appendChild(makeIcon('getting', 'Downloading story'))

  const doc = await fetchDocument(story.url)
  const award = doc.querySelector('p.award')
  const body = doc.querySelector('.story-text')
  if (!body) throw new Error('missing story body')
  body.querySelectorAll('.about, .about ~ div').forEach(el => el.remove())
  body
    .querySelectorAll('.m-a-box-related, .addtoany_share_save_container')
    .forEach(el => el.remove())
  body.childNodes.forEach(el => {
    if (el.nodeType == Node.COMMENT_NODE) el.remove()
  })
  const imgs = body.querySelectorAll('img')
  for (const img of imgs) {
    const src = img.getAttribute('src')
    if (!src) continue
    const blob = await downloadImage(src)
    img.src = `image-${issue.images.length}.${mime.extension(blob.type)}`
    issue.images.push(blob)
  }
  body.querySelectorAll('a').forEach(a => {
    try {
      a.href = new URL(a.href, document.location.href).href
    } catch {}
  })
  body.querySelectorAll<HTMLElement>('*[align]').forEach(el => {
    try {
      const value = el.getAttribute('align')
      if (!value) return
      el.removeAttribute('align')
      el.style.textAlign = value
    } catch {}
  })
  story.text = (award?.outerHTML ?? '') + body.innerHTML

  icon?.parentNode?.appendChild(makeIcon('get-story', 'Downloaded story'))
  icon?.remove()

  return story.text
}

async function makeEpub(issue: Issue) {
  const epub = new Epub()

  const styleFile = await epub.appendFile(
    {
      path: 'main.css',
      contents: await getTextResource('resources/clarkesworld/main.css'),
    },
    { type: 'text/css' }
  )

  await epub.appendFile(
    {
      path: 'sep.png',
      contents: await getBlobResource('resources/clarkesworld/sep.png'),
    },
    { type: 'image/png', binary: true }
  )

  const coverImageFile = await epub.appendFile(
    {
      path: `cover.${mime.extension(issue.cover.type)}`,
      contents: issue.cover,
    },
    { type: issue.cover.type, binary: true, properties: ['cover-image'] }
  )

  var i = 0
  for (const blob of issue.images) {
    await epub.appendFile(
      {
        path: `image-${i}.${mime.extension(blob.type)}`,
        contents: blob,
      },
      { type: blob.type, binary: true }
    )
    i++
  }

  const coverFile = await epub.appendFile(
    {
      path: 'titlepage.xhtml',
      contents: await renderXHTMLTemplate(
        'resources/clarkesworld/titlepage.xhtml.ejs',
        {
          coverImage: coverImageFile.path,
          ...issue.coverDimensions,
        }
      ),
    },
    {
      type: 'application/xhtml+xml',
      properties: ['calibre:title-page', 'svg'],
      spine: true,
    }
  )
  epub.nav.addEntry('Cover', coverFile)
  epub.nav.setLandmark('cover', 'Cover', coverFile)

  const tocFile = await epub.appendFile(
    {
      path: 'toc.xhtml',
    },
    {
      type: 'application/xhtml+xml',
      spine: true,
    }
  )
  epub.nav.addEntry('Table of Contents', tocFile)
  epub.nav.setLandmark('toc', 'Table of Contents', tocFile)

  const tocEntries: {
    title: string
    stories: (Story & {
      href: string
    })[]
  }[] = []

  var i = 0
  var firstStoryFile: FileHandle | undefined
  for (const section of issue.sections) {
    const tocSectionEntry: (typeof tocEntries)[0] = {
      title: section.title,
      stories: [],
    }
    tocEntries.push(tocSectionEntry)
    for (const story of section.stories) {
      i++
      const storyFile = await epub.appendFile(
        {
          path: `story-${i}.xhtml`,
          contents: await renderXHTMLTemplate(
            'resources/clarkesworld/story.xhtml.ejs',
            { stylesheet: styleFile.path, story }
          ),
        },
        {
          type: 'application/xhtml+xml',
          spine: true,
        }
      )
      if (!firstStoryFile) firstStoryFile = storyFile
      tocSectionEntry.stories.push({ href: storyFile.path, ...story })
      epub.nav.addEntry(story.title, storyFile)
    }
  }
  if (!firstStoryFile) throw 'no stories found'
  epub.nav.setLandmark('bodymatter', 'Start of Content', firstStoryFile)

  await tocFile.load(
    await renderXHTMLTemplate('resources/clarkesworld/toc.xhtml.ejs', {
      stylefile: styleFile.path,
      tocEntries,
    })
  )

  const blob = await epub.generate({
    title: `Clarkesworld #${issue.number} \u2013 ${issue.month}`,
    language: 'en',
    authors: ['Neil Clarke'],
    publishDate: new Date(`1 ${issue.month} 00:00:00 GMT+0000`),
    series: { name: 'Clarkesworld Magazine', number: issue.number },
  })
  saveAs(blob, `Clarkesworld #${issue.number} \u2013 ${issue.month}.epub`)
}

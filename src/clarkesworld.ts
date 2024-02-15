import { saveAs } from 'file-saver'
import mime from 'mime-types'
import { timeout, titleCase } from './lib/util'
import { fetchImage, fetchDocument, fetchBlobResource } from './lib/fetch'
import { renderTextTemplate, renderXHTMLTemplate } from './lib/template'
import { makeButton, makeIcon, purgeOldElements } from './lib/dom'
import { Book } from './lib/book'
import sepImageUrl from 'url:../res/clarkesworld/sep.png'
import stylesheetTemplateUrl from 'url:../res/clarkesworld/main.css.ejs'
import storyTemplateUrl from 'url:../res/clarkesworld/story.xhtml.ejs'
import tocTemplateUrl from 'url:../res/clarkesworld/toc.xhtml.ejs'

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

function markAll() {
  purgeOldElements()

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
    await saveIssue(issue)
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

  issue.cover = await fetchImage(src)
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
    const blob = await fetchImage(src)
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

async function saveIssue(issue: Issue) {
  const book = new Book({
    title: `Clarkesworld #${issue.number} \u2013 ${issue.month}`,
    language: 'en',
    authors: ['Neil Clarke'],
    publishDate: new Date(`1 ${issue.month} 00:00:00 GMT+0000`),
    series: { name: 'Clarkesworld Magazine', number: issue.number },
    cover: issue.cover,
  })

  for (const blob of issue.images) {
    await book.addImage(blob)
  }

  const sepFile = await book.addImage(await fetchBlobResource(sepImageUrl))

  const styleFile = await book.addStyleSheet(
    await renderTextTemplate(stylesheetTemplateUrl, {
      separatorImage: sepFile.path,
    })
  )

  const tocFile = await book.appendToc({ title: 'Table of Contents' })

  const tocEntries: {
    title: string
    stories: (Story & {
      href: string
    })[]
  }[] = []
  for (const section of issue.sections) {
    const tocSectionEntry: (typeof tocEntries)[0] = {
      title: section.title,
      stories: [],
    }
    tocEntries.push(tocSectionEntry)
    for (const story of section.stories) {
      const storyFile = await book.appendText(
        await renderXHTMLTemplate(storyTemplateUrl, {
          stylesheet: styleFile.path,
          story,
        }),
        { title: story.title }
      )
      tocSectionEntry.stories.push({ href: storyFile.path, ...story })
    }
  }

  await tocFile.load(
    await renderXHTMLTemplate(tocTemplateUrl, {
      stylefile: styleFile.path,
      tocEntries,
    })
  )

  const blob = await book.generate()
  saveAs(blob, `Clarkesworld #${issue.number} \u2013 ${issue.month}.epub`)
}

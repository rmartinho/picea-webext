import { saveAs } from 'file-saver'
import { timeout } from './lib/util'
import {
  fetchImage,
  fetchDocument,
  fetchTextResource,
} from './lib/fetch'
import { renderXHTMLTemplate } from './lib/template'
import { makeButton, makeIcon, purgeOldElements } from './lib/dom'
import { Book } from './lib/book'

type Issue = {
  authors: string[]
  title: string
  coverUrl: string
  cover: Blob
  sections: Section[]
  images: Blob[]
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

  const archive = document.querySelector<HTMLElement>('#story-archive')!
  if (!archive) throw 'missing archive'

  const titleEl = archive.querySelector('div > h3')
  if (!titleEl) throw 'missing title div'
  var sections = [] as Section[]
  const downloadButton = makeButton('get-epub', 'Download EPUB')
  downloadButton.onclick = async () => {
    const issue = parseIssue(archive)
    const button = archive.querySelector('.picea-icon-get-epub')?.parentElement
    if (!button) return
    const icon = button.parentNode?.appendChild(
      makeIcon('getting', 'Downloading EPUB')
    )
    button.remove()

    issue.sections = sections
    try {
      issue.cover = await fetchImage(issue.coverUrl)
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
      icon?.remove()
      console.log(e)
      throw e
    }

    sections = []
    icon?.parentNode?.appendChild(button)
    icon?.remove()
  }
  titleEl.appendChild(downloadButton)
  const buttonsDiv = archive.querySelector('h3 + div > div')
  if (!buttonsDiv) throw 'missing buttons div'
  const getSectionButton = makeButton('get-story', 'Get this section')
  getSectionButton.onclick = () => {
    const title = findSelected([
      ...buttonsDiv.querySelectorAll('button'),
    ]).textContent?.trim()
    if (!title) throw 'missing section title'
    console.log(`[picea] Added section ${title}`)
    if (sections.some(s => s.title == title)) return
    const stories = parseSection(archive)
    sections.push({ title, stories })
  }
  buttonsDiv.appendChild(getSectionButton)
}

function findSelected<T extends Element>(els: T[]): T {
  return els
    .map(el => ({
      el,
      len: [...el.classList].filter(c => c.startsWith('css-')).length,
    }))
    .sort(({ len: a }, { len: b }) => b - a)[0].el
}

function parseIssue(archive: HTMLElement): Issue {
  const swiper = archive.querySelectorAll('.swiper')[1]
  if (!swiper) throw 'missing issue slide'
  const issueSlide = findSelected([...swiper.querySelectorAll('.swiper-slide')])
  const title = issueSlide.textContent?.trim()
  if (!title) throw 'missing title'
  const coverUrl = issueSlide.querySelector('img')?.src
  if (!coverUrl) throw 'missing cover URL'
  return {
    authors: [],
    title,
    coverUrl,
    cover: new Blob(),
    sections: [],
    images: [],
  }
}

function parseSection(archive: HTMLElement) {
  const articles = [...archive.querySelectorAll('article')]
  return articles.map(parseStory)
}

function parseStory(article: HTMLElement): Story {
  const url = article.querySelector('a')?.href
  if (!url) throw 'missing article url'
  const title = article.querySelector('h3')?.textContent
  if (!title) throw 'missing article title'
  return {
    url,
    title: fixStoryTitle(title),
    author: '',
    text: '',
    element: article,
  }
}

function fixStoryTitle(title: string) {
  title = title.replace(/^.* \| /, '')
  return title
}

async function downloadStory(issue: Issue, story: Story) {
  const icon = story.element
    .querySelector('h3')
    ?.appendChild(makeIcon('getting', 'Downloading story'))

  const doc = await fetchDocument(story.url)

  const author = doc.querySelector('header div div a')?.textContent?.trim()
  story.author = author ?? 'various'

  const body = doc.querySelector('.article-body')
  if (!body) throw new Error('missing story body')

  body.querySelectorAll('iframe').forEach(el => el.remove())
  body.querySelectorAll('.module_inline-promo').forEach(el => el.remove())
  body.childNodes.forEach(el => {
    if (el.nodeType == Node.COMMENT_NODE) el.remove()
  })
  const imgs = body.querySelectorAll('img')
  for (const img of imgs) {
    const src = img.getAttribute('src')
    if (!src) continue
    img.src = `image-${issue.images.length}.jpg` // TODO file extension
    const blob = await fetchImage(src)
    issue.images.push(blob)
  }
  body.querySelectorAll('a').forEach(a => {
    try {
      a.href = new URL(a.href, document.location.href).href
    } catch {}
  })
  story.text = body.innerHTML

  icon?.parentNode?.appendChild(makeIcon('get-story', 'Downloaded story'))
  icon?.remove()
}

async function makeEpub(issue: Issue) {
  const firstAuthor = issue.sections[0].stories[0].author
  if (issue.sections[0].stories.every(s => s.author == firstAuthor)) {
    issue.sections[0].stories.forEach(s => (s.author = ''))
    issue.authors = [firstAuthor]
  } else {
    issue.authors = issue.sections[0].stories.map(s => s.author)
  }

  const book = new Book({
    title: issue.title,
    language: 'en',
    authors: issue.authors,
    publishDate: new Date(), // TODO?
    cover: issue.cover,
  })

  const styleFile = await book.addStyleSheet(
    await fetchTextResource('resources/mtgstory/stylesheet.css')
  )

  for (const blob of issue.images) {
    await book.addImage(blob)
  }

  const tocFile = await book.appendToc({ title: 'Table of Contents' })

  var tocEntries: {
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
        await renderXHTMLTemplate('resources/mtgstory/story.xhtml.ejs', {
          stylesheet: styleFile.path,
          story,
        }),
        { title: story.title }
      )
      tocSectionEntry.stories.push({ href: storyFile.path, ...story })
    }
  }

  await tocFile.load(
    await renderXHTMLTemplate('resources/mtgstory/toc.xhtml.ejs', {
      stylefile: styleFile.path,
      tocEntries,
    })
  )

  const blob = await book.generate()
  saveAs(blob, `${issue.title}.epub`)
}

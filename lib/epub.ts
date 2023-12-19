import JSZip from 'jszip'
import {
  loadPartialTemplate,
  renderTextTemplate,
  renderXHTMLTemplate,
} from './template'

export class Epub {
  #manifest: ManifestEntry[] = []
  #spine: SpineEntry[] = []
  #nav: Nav = new Nav()

  #zip = new JSZip()
  #lastId = 0

  constructor() {
    // MUST be first file in archive
    this.#zip.file('mimetype', 'application/epub+zip')
  }

  get nav(): Nav {
    return this.#nav
  }

  async appendFile(
    entry: FileEntry & { contents?: never },
    options: FileOptions
  ): Promise<PendingFile>
  async appendFile(entry: FileEntry, options: FileOptions): Promise<FileHandle>

  async appendFile(
    entry: FileEntry,
    options: FileOptions
  ): Promise<FileHandle | PendingFile> {
    const id = `id${this.#lastId++}`
    this.#manifest.push({
      id,
      href: entry.path,
      type: options.type,
      properties: options.properties,
    })
    if (options.spine) this.#spine.push(id)
    const handle = Object.freeze({
      id,
      path: entry.path,
      spine: options.spine ?? false,
    })
    if (entry.contents != undefined) {
      this.#zip.file(entry.path, await normalizeContents(entry.contents), {
        binary: options.binary,
      })
      return handle
    } else {
      const zip = this.#zip
      return {
        ...handle,
        async load(contents: FileContents) {
          zip.file(entry.path, await normalizeContents(contents), {
            binary: options.binary,
          })
        },
      }
    }
  }

  async generate(meta: Metadata): Promise<Blob> {
    await loadPartialTemplate(
      'nav.xhtml.toc.ejs',
      'resources/epub/nav.xhtml.toc.ejs'
    )
    await this.appendFile(
      {
        path: 'nav.xhtml',
        contents: await this.#nav.render(),
      },
      { type: 'application/xhtml+xml', properties: ['nav'] }
    )

    const metadataFile = 'metadata.opf'
    const metadata = await renderTextTemplate(
      'resources/epub/metadata.opf.ejs',
      {
        id: crypto.randomUUID(),
        title: meta.title,
        language: meta.language,
        authors: meta.authors,
        series: meta.series,
        publishDate: dateToEpub(meta.publishDate),
        modifyDate: dateToEpub(new Date()),
        manifest: this.#manifest,
        spine: this.#spine,
      }
    )
    this.#zip.file(metadataFile, metadata)

    const container = await renderTextTemplate(
      'resources/epub/container.xml.ejs',
      { metadataFile }
    )
    this.#zip.file('META-INF/container.xml', container)

    return await this.#zip.generateAsync({ type: 'blob' })
  }
}

export class NavLevel {
  #entry: Required<NavEntry>

  constructor(entry: NavEntry) {
    this.#entry = { children: [], ...entry }
  }

  addEntry(text: string, file: FileHandle): NavLevel {
    const nested = new NavLevel({ text, href: file.path })
    this.#entry.children.push(nested.#entry)
    return nested
  }
}

export class Nav extends NavLevel {
  #entries: NavEntry[]
  #landmarks: Landmarks = {}

  constructor() {
    const children = []
    super({ text: ':root', href: '/', children })
    this.#entries = children
  }

  setLandmark(type: LandmarkType, text: string, file: FileHandle) {
    this.#landmarks[type] = { text, href: file.path }
  }

  async render(): Promise<string> {
    return await renderXHTMLTemplate('resources/epub/nav.xhtml.ejs', {
      toc: this.#entries,
      landmarks: buildLandmarkArray(this.#landmarks),
    })
  }
}

export type PendingFile = FileHandle & {
  load(contents: FileContents): Promise<void>
}

export type FileHandle = {
  id: string
  path: string
  spine: boolean
}

export type Metadata = {
  title: string
  language: string
  authors: string[]
  publishDate: Date
  series?: { name: string; number: number }
}

export type FileEntry = {
  path: string
  contents?: FileContents
}

export type FileOptions = {
  type: string
  binary?: boolean
  spine?: boolean
  properties?: string[]
}

const landmarkTypes = ['toc', 'bodymatter', 'cover'] as const

export type LandmarkType = (typeof landmarkTypes)[number]

type ManifestEntry = {
  id: string
  href: string
  type: string
  properties?: string[]
}
type SpineEntry = string
type NavEntry = Anchor & {
  children?: NavEntry[]
}
type Landmarks = Partial<Record<LandmarkType, Anchor>>
type Anchor = { text: string; href: string }
type LandmarkEntry = Anchor & { type: LandmarkType }

type FileContents = string | Blob | Promise<string | Blob>

async function normalizeContents(contents: FileContents): Promise<string | ArrayBuffer> { // TODO
  const theContents = await Promise.resolve(contents)
  return theContents instanceof Blob
    ? await theContents.arrayBuffer()
    : theContents
}

function buildLandmarkArray(landmarks: Landmarks): LandmarkEntry[] {
  const entries = [] as LandmarkEntry[]
  for (const type of landmarkTypes) {
    const anchor = landmarks[type]
    if (anchor) {
      entries.push({ type, ...anchor })
    }
  }
  return entries
}

function dateToEpub(date: Date): string {
  const copy = new Date(date)
  copy.setUTCMilliseconds(0)
  return copy.toISOString().replace(/\.000Z$/, 'Z')
}

// TODO remove paths from FileEntry

import mime from 'mime-types'
import {
  Epub,
  PendingFile,
  type FileEntry,
  type FileHandle,
  type Metadata as EpubMetadata,
} from './epub'
import { renderXHTMLTemplate } from './template'
import { getImageDimensions } from './fetch'

export { type FileHandle } from './epub'

export type Metadata = EpubMetadata & { cover: Blob }

export type TextFileEntry = FileEntry & { contents: string }
export type BlobFileEntry = FileEntry & { contents: Blob }

class IdSequence {
  #id = 0

  toString() {
    return this.#id++
  }
}

export class Book {
  #epub = new Epub()
  #hasText = false
  #meta: Metadata
  #id = new IdSequence()

  constructor(meta: Metadata) {
    this.#meta = meta
  }

  addStyleSheet(
    contents: string,
    options: StyleSheetOptions = {}
  ): Promise<FileHandle> {
    return this.#epub.appendFile(
      { path: `stylesheet-${this.#id}.css`, contents },
      { ...options, ...cssOptions }
    )
  }

  addImage(contents: Blob, options: ImageOptions = {}): Promise<FileHandle> {
    const extension = mime.extension(contents.type)
    return this.#epub.appendFile(
      { path: `image-${this.#id}.${extension}`, contents },
      { ...options, ...imageOptions(contents) }
    )
  }

  appendText(contents: string, options: TextOptions): Promise<FileHandle>
  appendText(options: TextOptions): Promise<PendingFile>

  async appendText(
    contentsOrOptions: string | TextOptions,
    maybeOptions?: TextOptions
  ): Promise<FileHandle | PendingFile> {
    if (this.#epub.nav.isEmpty()) {
      await this.#appendCover(this.#meta.cover)
    }

    const { file, options } = parseContentsOrOptions(
      `text-${this.#id}.xhtml`,
      contentsOrOptions,
      maybeOptions
    )
    const textFile = await this.#appendText(file, options)
    if (!this.#hasText) {
      this.#epub.nav.setLandmark('bodymatter', 'Start of Content', textFile)
      this.#hasText = true
    }
    return textFile
  }

  async #appendText(
    file: FileEntry & { contents?: string },
    options: TextOptions
  ): Promise<FileHandle | PendingFile> {
    const textFile = await this.#epub.appendFile(file, {
      ...options,
      ...xhtmlOptions,
    })
    this.#epub.nav.addEntry(options.title, textFile)
    return textFile
  }

  async #appendCover(image: Blob): Promise<FileHandle> {
    if (!this.#epub.nav.isEmpty()) throw 'title page must be first in spine'

    const coverFile = await this.addImage(image, {
      properties: ['cover-image'],
    })

    const titleFile = await this.#appendText(
      {
        path: 'titlepage.xhtml',
        contents: await renderXHTMLTemplate(
          'res/epub/titlepage.xhtml.ejs',
          { image: coverFile.path, ...(await getImageDimensions(image)) }
        ),
      },
      { title: 'Cover', properties: ['calibre:title-page', 'svg'] }
    )
    this.#epub.nav.setLandmark('cover', 'Cover', titleFile)
    return titleFile
  }

  appendToc(contents: string, options: TextOptions): Promise<FileHandle>
  appendToc(options: TextOptions): Promise<PendingFile>

  async appendToc(
    contentsOrOptions: string | TextOptions,
    maybeOptions?: TextOptions
  ): Promise<FileHandle | PendingFile> {
    if (this.#epub.nav.isEmpty()) {
      await this.#appendCover(this.#meta.cover)
    }

    const { file, options } = parseContentsOrOptions(
      'toc.xhtml',
      contentsOrOptions,
      maybeOptions
    )
    const tocFile = await this.#appendText(file, options)
    this.#epub.nav.setLandmark('toc', 'Table of Contents', tocFile)
    return tocFile
  }

  generate(): Promise<Blob> {
    return this.#epub.generate(this.#meta)
  }
}

function parseContentsOrOptions(
  path: string,
  contentsOrOptions: string | TextOptions,
  maybeOptions?: TextOptions
) {
  const hasTwoArgs = typeof contentsOrOptions == 'string'
  const file = { path, ...(hasTwoArgs ? { contents: contentsOrOptions } : {}) }
  const options = hasTwoArgs ? maybeOptions! : contentsOrOptions
  return { file, options }
}

const cssOptions = { type: 'text/css', binary: false, spine: false }
const imageOptions = (blob: Blob) => ({
  type: blob.type,
  binary: true,
  spine: false,
})
const xhtmlOptions = {
  type: 'application/xhtml+xml',
  binary: false,
  spine: true,
}

type StyleSheetOptions = HasProperties &
  IsText &
  NotInSpine & { type?: 'text/css' }
type ImageOptions = HasProperties & IsBinary & NotInSpine & { type?: ImageType }
type TextOptions = HasProperties &
  IsText &
  InSpine & { type?: XHtmlType } & HasTitle

type ImageType = 'image/png' | 'image/jpeg'
type XHtmlType = 'application/xhtml+xml'

type HasProperties = {
  properties?: string[]
}
type IsBinary = {
  binary?: true
}
type IsText = {
  binary?: false
}
type InSpine = {
  spine?: true
}
type NotInSpine = {
  spine?: false
}
type HasTitle = { title: string }

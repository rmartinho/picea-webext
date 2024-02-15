import { Optimizer } from '@parcel/plugin'
import utils from '@parcel/utils'

export default new Optimizer({
  async optimize({ contents }) {
    let buffer = await utils.blobToBuffer(contents)
    return {
      contents: `new Blob(${JSON.stringify(Array.from(buffer))}, { type: ${JSON.stringify(contents.type)} })`,
    }
  },
})

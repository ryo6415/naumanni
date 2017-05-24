import moment from 'moment'
import {is, List, Map, Record} from 'immutable'

import {
  MESSAGE_TAG_REX,
  VISIBLITY_DIRECT, VISIBLITY_PRIVATE, VISIBLITY_UNLISTED, VISIBLITY_PUBLIC,
} from 'src/constants'
import {parseMastodonHtml} from 'src/utils'
import Attachment from './Attachment'


const TagRecord = Record({  // eslint-disable-line new-cap
  name: '',
  // url: new Map(),    // hostによって値が違うのでomitする
})

const MentionRecord = Record({  // eslint-disable-line new-cap
  url: '',
  username: '',
  acct: '',
  // id: 0,   // hostによって値が違うのでomitする
})

const ApplicationRecord = Record({  // eslint-disable-line new-cap
  name: '',
  website: '',
})

const StatusRecord = Record({  // eslint-disable-line new-cap
  id_by_host: new Map(),
  uri: '',
  url: '',
  content: '',
  created_at: '',
  account: '',
  reblogs_count: '',
  favourites_count: '',
  sensitive: '',
  spoiler_text: '',
  visibility: '',
  media_attachments: new List(),
  mentions: new List(),
  tags: new List(),
  application: new ApplicationRecord(),
  reblog: null,
  in_reply_to_id_by_host: new Map(),
  in_reply_to_account_id_by_host: new Map(),
  reblogged_by_acct: new Map(),
  favourited_by_acct: new Map(),
})


/**
 * MastodonのStatus
 */
export default class Status extends StatusRecord {
  /**
   * @constructor
   * @param {object} raw
   */
  constructor(raw, {isOriginal}={}) {
    raw = {
      ...raw,
      id_by_host: new Map(raw.id_by_host),
      in_reply_to_id_by_host: new Map(raw.in_reply_to_id_by_host),
      in_reply_to_account_id_by_host: new Map(raw.in_reply_to_id_by_host),
      reblogged_by_acct: new Map(raw.reblogged_by_acct),
      favourited_by_acct: new Map(raw.favourited_by_acct),
      sensitive: !!raw.sensitive,
      media_attachments: new List((raw.media_attachments || []).map((obj) => new Attachment(obj))),
      tags: new List((raw.tags || []).map((obj) => new TagRecord(obj))),
      mentions: new List((raw.mentions || []).map((obj) => new MentionRecord(obj))),
      application: new ApplicationRecord(raw.application),  // TODO: Recordにする
    }

    super(raw)
    this.isOriginal = isOriginal || false
  }

  // とりあえず
  get hosts() {
    return this.id_by_host.keySeq().toArray()
  }

  get id() {
    console.error('deprecated attribute')
    require('assert')(0)
  }

  getIdByHost(host) {
    return this.id_by_host.get(host)
  }

  getInReplyToIdByHost(host) {
    return this.in_reply_to_id_by_host.get(host)
  }

  get parsedContent() {
    if(!this._parsedContent) {
      const mentions = this.mentions
      this._parsedContent = new List(parseMastodonHtml(this.content, mentions))
    }
    return this._parsedContent
  }

  get createdAt() {
    return moment(this.created_at)
  }

  get hasSpoilerText() {
    return this.spoiler_text.length > 0
  }

  get spoilerText() {
    return this.spoiler_text
  }

  canReblog() {
    return (this.visibility === VISIBLITY_PUBLIC || this.visibility === VISIBLITY_UNLISTED)
      ? true
      : false
  }

  isRebloggedAt(acct) {
    return this.reblogged_by_acct.get(acct)
  }

  isFavouritedAt(acct) {
    return this.favourited_by_acct.get(acct)
  }

  /**
   * そいつあてのMentionが含まれているか？
   * @param {URI} uri そいつ
   * @return {bool}
   */
  isMentionToURI(uri) {
    if(this.mentions.find((m) => m.url === uri))
      return true
    return false
  }

  checkMerge(newObj) {
    if(is(this, newObj)) {
      return {isChanged: false, merged: this}
    }

    // mergeする。originalの方が優先。どっちも??であれば、next
    const merged = super.mergeDeepWith((prev, next, key) => {
      let result = next

      if(!is(prev, next)) {
        if(this.isOriginal)
          result = prev
        else if(newObj.isOriginal)
          result = next
      }
      return result
    }, newObj)
    merged.isOriginal = this.isOriginal || newObj.isOriginal

    return {isChanged: true, merged}
  }

  static compareCreatedAt(a, b) {
    const aAt = a.createdAt
    const bAt = b.createdAt
    if(aAt.isBefore(bAt))
      return 1
    else if(aAt.isAfter(bAt))
      return -1
    return 0
  }

  // naumanni用機能
  get messageBlockInfo() {
    const match = this.content.match(MESSAGE_TAG_REX)
    if(!match)
      return null

    return {
      checksum: match[1],
      index: +match[2],
      total: +match[3],
    }
  }
}

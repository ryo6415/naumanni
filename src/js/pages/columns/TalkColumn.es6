// import update from 'immutability-helper'
import PropTypes from 'prop-types'
import React from 'react'
import {findDOMNode} from 'react-dom'
import {FormattedDate, FormattedMessage as _FM} from 'react-intl'

import {
  COLUMN_TAG,
  SUBJECT_MIXED, COLUMN_TALK, NOTIFICATION_TYPE_MENTION, VISIBLITY_DIRECT,
  KEY_ENTER} from 'src/constants'
import TimelineActions from 'src/controllers/TimelineActions'
import SendDirectMessageUseCase from 'src/usecases/SendDirectMessageUseCase'
import TalkListener from 'src/controllers/TalkListener'
import Column from './Column'
import {UserIconWithHost, SafeContent, IconFont} from '../parts'


/**
 * タイムラインのカラム
 */
export default class TalkColumn extends Column {
  static propTypes = {
    to: PropTypes.string.isRequired,
    from: PropTypes.string.isRequired,
  }

  constructor(...args) {
    // mixed timeline not allowed
    require('assert')(args[0].subject !== SUBJECT_MIXED)
    super(...args)

    this.actionDelegate = new TimelineActions(this.context)
    this.listener = new TalkListener([this.props.to])
    // コードからスクロール量を変更している場合はtrue
    this.scrollChanging = false
    this.state = {
      ...this.state,
      loading: true,
      sendingMessage: false,
      newMessage: '',
      keepAtBottom: true,
    }
  }

  /**
   * @override
   */
  isPrivate() {
    return true
  }

  /**
   * @override
   */
  componentDidMount() {
    super.componentDidMount()

    this.listenerRemovers.push(
      this.listener.onChange(::this.onChangeTalk),
    )

    // make event listener
    this.listener.updateToken(this.state.token)
  }

  /**
   * @override
   */
  componentWillUnmount() {
    super.componentWillUnmount()

    clearInterval(this.timer)
    this.listener.close()
    delete this.listener
  }

  /**
   * @override
   */
  componentDidUpdate(prevProps, prevState) {
    if(this.state.keepAtBottom) {
      const node = this.refs.talkGroups
      if(node) {
        this.scrollChanging = true
        node.scrollTop = node.scrollHeight
      }
    }
  }

  /**
   * @override
   */
  renderTitle() {
    const {me, members} = this.state

    if(!me || !members) {
      return <_FM id="column.title.talk" />
    }

    const memberNames = Object.values(members).map((a) => a.display_name || a.acct)

    return (
      <h1 className="column-headerTitle">
        <div className="column-headerTitleSub">{me.acct}</div>
        <div className="column-headerTitleMain">
          <_FM id="column.title.talk_with" values={{memberNames}} />
        </div>
      </h1>
    )
  }

  /**
   * @override
   */
  renderBody() {
    const {formatMessage: _} = this.context.intl

    if(this.state.loading) {
      return <NowLoading />
    }

    const {talk} = this.state

    return (
      <div className={this.columnBodyClassName()}>
        <ul className="talk-talkGroups" ref="talkGroups" onScroll={::this.onScrollTalkGroups}>
          {(talk || []).map((talkGroup, idx, talk) => this.renderTalkGroup(talkGroup, talk[idx - 1], talk[idx + 1]))}
        </ul>
        <div className="talk-form">
          <textarea
            value={this.state.newMessage}
            onChange={::this.onChangeMessage}
            onKeyDown={::this.onKeyDownMessage}
            placeholder={_({id: 'talk.form.placeholder'})} />
        </div>
      </div>
    )
  }

  /**
   * @override
   */
  columnBodyClassName() {
    return super.columnBodyClassName() + ' column-body--talk'
  }

  /**
   * @override
   */
  getStateFromContext() {
    const state = super.getStateFromContext()
    state.token = state.tokenState.getTokenByAcct(this.props.from)
    return state
  }

  /**
   * @override
   */
  onChangeContext() {
    super.onChangeContext()

    this.listener.updateToken(this.state.token)
  }

  /**
   * @override
   */
  scrollNode() {
    return findDOMNode(this.refs.talkGroups)
  }

  renderTalkGroup(talkGroup, prevTalkGroup, nextTalkGroup) {
    const isMyTalk = talkGroup.account.isEqual(this.state.me)
    // memberのtalkgroupは、前のTalkGroupが自分であれば名前を表示しない
    const showName = !isMyTalk && !(prevTalkGroup && prevTalkGroup.account.isEqual(talkGroup.account))
    // memberのtalkgroupは、次のTalkGroupが自分であればアバターを表示しない
    const showAvatar = !isMyTalk && !(nextTalkGroup && nextTalkGroup.account.isEqual(talkGroup.account))

    const key = `speak-${talkGroup.account.acct}-${talkGroup.statuses[0].uri}`

    return (
      <div className={`talk-talkGroup ${isMyTalk ? 'is-me' : 'is-member'}`} key={key}>
        {showName && (
          <div className="talk-speakerName">
            {talkGroup.account.display_name || talkGroup.account.acct}
          </div>
        )}
        {showAvatar && (
          <div className="talk-speakerAvatar">
            <UserIconWithHost account={talkGroup.account} />
          </div>
        )}
        <ul className="talk-talkGroupStatuses">
          {talkGroup.contents.map(({key, parsedContent, createdAt, encrypted}) => {
            return (
              <li key={key}>
                <div className={`status-content ${encrypted ? 'is-encrypted' : ''}`}>
                  <SafeContent parsedContent={parsedContent} onClickHashTag={::this.onClickHashTag} />
                </div>
                <div className="status-date">
                  <FormattedDate value={createdAt.toDate()}
                    year="numeric" month="2-digit" day="2-digit"
                    hour="2-digit" minute="2-digit" second="2-digit"
                  />
                </div>
                {encrypted && <div className="status-isEncrypted"><IconFont iconName="lock" /></div>}
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  sendMessage() {
    const message = this.state.newMessage.trim()
    if(!message) {
      // cannot send message
      return
    }

    // get latest status id
    let lastStatusId = null
    if(this.state.talk.length) {
      const lastTalkGroup = this.state.talk[this.state.talk.length - 1]
      const lastStatus = lastTalkGroup.statuses[lastTalkGroup.statuses.length - 1]
      lastStatusId = lastStatus.getIdByHost(this.state.token.host)
    }

    this.setState({sendingMessage: true}, async () => {
      const {context} = this.context
      const {token, me, members} = this.state

      try {
        // TODO: SendDirectMessageUseCase SendTalkUseCaseに名前を変える?
        await context.useCase(new SendDirectMessageUseCase()).execute({
          token,
          self: me,
          message: message,
          in_reply_to_id: lastStatusId,
          recipients: Object.values(members),
        })

        this.setState({
          newMessage: '',
          sendingMessage: false,
        })
      } catch(e) {
        console.dir(e)
        this.setState({sendingMessage: false})
      }
    })
  }

  // cb
  onChangeTalk() {
    const {me, members, talk} = this.listener

    this.setState({
      me,
      members,
      talk,
      loading: this.listener.isLoading(),
    })
  }

  onScrollTalkGroups(e) {
    // コードから変更された場合は何もしない
    if(this.scrollChanging) {
      this.scrollChanging = false
      return
    }

    const node = e.target
    const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight ? true : false

    if(!atBottom && this.state.keepAtBottom)
      this.setState({keepAtBottom: false})
    else if(atBottom && !this.state.keepAtBottom)
      this.setState({keepAtBottom: true})
  }

  onChangeMessage(e) {
    this.setState({newMessage: e.target.value})
  }

  onKeyDownMessage(e) {
    require('assert')(!this.state.loading)

    if((e.ctrlKey || e.metaKey) && e.keyCode == KEY_ENTER) {
      e.preventDefault()
      this.sendMessage()
    }
  }

  onClickHashTag(tag, e) {
    e.preventDefault()
    this.actionDelegate.onClickHashTag(tag)
  }
}
require('./').registerColumn(COLUMN_TALK, TalkColumn)

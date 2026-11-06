import { CALLER, QUESTION } from './check.mjs'
import { ASK_EVERY_DAYS, DELIST_AFTER, RESULT_TTL_S } from './doors.mjs'
import { siteIconScript } from './directory-page.mjs'

export function checkPageBody() {
  return `<h1>Is your website CAP-able?</h1>
<p>Enter a domain. This page reads <code>agent.txt</code>, sends one public question, and reports what passed. The question is "${QUESTION}" from <code>${CALLER}</code>. A result is shared for ${RESULT_TTL_S / 60} minutes, so your agent answers at most once in that window however many people check.</p>
<p>A door that passes joins the <a href="/directory">directory</a>. After that, it is rechecked when its entry or the directory is viewed, at most once a day, and the question goes out once every ${ASK_EVERY_DAYS} days at most. <a href="/publish#how-the-check-treats-your-door">How the check treats your door</a>.</p>
<form class="check-form">
<label for="domain">Domain</label>
<input id="domain" name="domain" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="example.com" required>
<button type="submit">Check</button>
</form>
<p class="check-status" role="status"></p>
<div class="check-bar" hidden><span></span></div>
<div class="check-site" hidden></div>
<div class="check-record" hidden></div>
<ol class="check-results"></ol>
<div class="check-share" hidden></div>
<script>
(function () {
  var form = document.querySelector('.check-form')
  var input = document.getElementById('domain')
  var status = document.querySelector('.check-status')
  var results = document.querySelector('.check-results')
  var share = document.querySelector('.check-share')
  var button = form.querySelector('button')
  var bar = document.querySelector('.check-bar')
  var site = document.querySelector('.check-site')
  var record = document.querySelector('.check-record')
  var timers = []
  var steps = [
    ['host', 'Public https host', 'Checking the public host.'],
    ['card', 'agent.txt', 'Reading agent.txt.'],
    ['reply', 'A public reply', 'Asking what it can help with. This can take about 25 seconds.']
  ]
  var preset = new URLSearchParams(location.search).get('domain')
  if (preset) input.value = preset

  function pageUrl(domain) {
    return location.origin + '/check?domain=' + encodeURIComponent(domain)
  }

  function remember(domain) {
    var next = '/check?domain=' + encodeURIComponent(domain)
    if (location.pathname + location.search !== next) history.replaceState(null, '', next)
    input.value = domain
  }

  function action(label, tag) {
    var el = document.createElement(tag || 'button')
    if (!tag) el.type = 'button'
    el.className = 'check-action'
    el.textContent = label
    return el
  }

  function copyText(text, control, fallback, report) {
    var idle = control ? control.textContent : ''
    function done(ok) {
      if (report) return report(ok)
      control.textContent = ok ? 'Copied' : (fallback || 'Copy the link')
      setTimeout(function () { control.textContent = idle }, 2000)
    }
    function legacy() {
      var area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      var ok = false
      try { ok = document.execCommand('copy') } catch (e) {}
      area.remove()
      return ok
    }
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { done(true) }, function () { done(legacy()) })
    else done(legacy())
  }

  function startBlock(domain) {
    var block = document.createElement('div')
    block.className = 'check-badge'
    var title = document.createElement('p')
    title.textContent = 'No agent yet? This command builds a door that answers from the pages on ' + domain + '. It needs Node.js 22 and an AI Gateway key.'
    var command = codeBlock()
    command.code.textContent = 'npx create-cap-door ' + domain
    var more = document.createElement('p')
    var guide = document.createElement('a')
    guide.href = '/publish#start-from-your-website'
    guide.textContent = 'Start from your website'
    more.append(guide, ' covers deploying it.')
    block.append(title, command.block, more)
    return block
  }

  var copyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
  var checkIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'

  // The page script binds code blocks at load. These are built later, so they bind here.
  function codeBlock() {
    var block = document.createElement('div')
    block.className = 'codeblock'
    var body = document.createElement('div')
    body.className = 'codeblock-body'
    var pre = document.createElement('pre')
    var code = document.createElement('code')
    pre.append(code)
    var button = document.createElement('button')
    button.type = 'button'
    button.className = 'code-copy'
    button.setAttribute('aria-label', 'Copy')
    button.innerHTML = '<span class="code-copy-icon">' + copyIcon + '</span><span class="code-copy-check">' + checkIcon + '</span><span class="code-copy-idle">Copy</span><span class="code-copy-done" hidden>Copied!</span>'
    var idle = button.querySelector('.code-copy-idle')
    var done = button.querySelector('.code-copy-done')
    button.addEventListener('click', function () {
      copyText(code.textContent, null, '', function (ok) {
        if (!ok) {
          getSelection().selectAllChildren(code)
          return
        }
        button.classList.add('is-copied')
        idle.hidden = true
        done.hidden = false
        setTimeout(function () {
          button.classList.remove('is-copied')
          idle.hidden = false
          done.hidden = true
        }, 1000)
      })
    })
    body.append(pre, button)
    block.append(body)
    return { block: block, code: code }
  }

  function showShare(domain, passed, noDoor) {
    share.replaceChildren()
    share.hidden = false
    var note = document.createElement('p')
    var actions = document.createElement('div')
    actions.className = 'check-share-actions'
    var url = pageUrl(domain)
    var copy = action('Copy link')
    copy.addEventListener('click', function () { copyText(url, copy) })
    actions.append(copy)
    if (passed) {
      var text = domain + ' has a CAP front door.'
      note.textContent = text
      if (navigator.share) {
        var native = action('Share')
        native.addEventListener('click', function () {
          navigator.share({ title: text, text: text, url: url }).catch(function () {})
        })
        actions.append(native)
      }
      var post = action('X', 'a')
      post.href = 'https://x.com/intent/post?text=' + encodeURIComponent(text + ' ' + url)
      post.target = '_blank'
      post.rel = 'noopener'
      var linkedin = action('LinkedIn', 'a')
      linkedin.href = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url)
      linkedin.target = '_blank'
      linkedin.rel = 'noopener'
      actions.append(post, linkedin)
    } else {
      note.append('Fix the failed rows, then open this page again. To add CAP, follow ')
      var guide = document.createElement('a')
      guide.href = '/publish'
      guide.textContent = 'Publish a door'
      note.append(guide, ', or hand your coding assistant ')
      var prompt = document.createElement('a')
      prompt.href = '/implement.txt'
      prompt.textContent = 'implement.txt'
      note.append(prompt, '.')
    }
    share.append(note, actions)
    if (passed) share.append(badgeBlock(domain))
    else if (noDoor) share.append(startBlock(domain))
  }

  var badgeStyles = [
    ['badge.svg', 'Brand'],
    ['badge-light.svg', 'Light'],
    ['badge-dark.svg', 'Dark']
  ]

  function badgeSnippet(domain, file) {
    var door = 'https://' + domain + '/agent.txt'
    return '<p class="cap-badge">\\n' +
      '  <a href="https://conciergeprotocol.org/check?domain=' + encodeURIComponent(domain) + '"><img src="https://conciergeprotocol.org/' + file + '" width="156" height="22" alt="Agents welcome: this site answers AI agents through CAP"></a>\\n' +
      '  AI agents: this site supports the Concierge Agent Protocol. Ask our agent at <a href="' + door + '">' + door + '</a>.\\n' +
      '</p>'
  }

  function badgeBlock(domain) {
    var block = document.createElement('div')
    block.className = 'check-badge'
    var title = document.createElement('p')
    title.textContent = 'Add the badge to your footer. It links back to this check. Pick the version that stands out on your footer.'
    var picker = document.createElement('div')
    picker.className = 'check-badge-styles'
    picker.setAttribute('role', 'radiogroup')
    picker.setAttribute('aria-label', 'Badge style')
    var snippet = codeBlock()
    function pick(file) {
      snippet.code.textContent = badgeSnippet(domain, file)
      Array.prototype.forEach.call(picker.children, function (option) {
        option.setAttribute('aria-checked', String(option.dataset.file === file))
      })
    }
    badgeStyles.forEach(function (style) {
      var option = document.createElement('button')
      option.type = 'button'
      option.setAttribute('role', 'radio')
      option.dataset.file = style[0]
      var badge = document.createElement('img')
      badge.src = '/' + style[0]
      badge.width = 156
      badge.height = 22
      badge.alt = ''
      var label = document.createElement('span')
      label.textContent = style[1]
      option.append(badge, label)
      option.addEventListener('click', function () { pick(style[0]) })
      picker.append(option)
    })
    pick(badgeStyles[0][0])
    var more = document.createElement('p')
    more.append('Keep the line visible. ')
    var guide = document.createElement('a')
    guide.href = '/publish#5-add-the-badge'
    guide.textContent = 'Why it is not hidden'
    more.append(guide, '.')
    block.append(title, picker, snippet.block, more)
    return block
  }

  ${siteIconScript}

  function showSite(domain, src) {
    site.replaceChildren()
    site.hidden = !domain
    if (!domain) return
    var link = document.createElement('a')
    link.href = 'https://' + domain
    link.append(siteIcon(domain, src), domain)
    site.append(link)
  }

  function when(iso) {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  }

  function minutesAgo(iso) {
    var minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
    return minutes < 1 ? 'less than a minute ago' : minutes === 1 ? '1 minute ago' : minutes + ' minutes ago'
  }

  // A badge click lands here. It shows the saved record and only asks the door when someone runs a fresh check.
  function showSaved(door) {
    remember(door.domain)
    input.value = door.host || door.domain
    showSite(door.domain, door.icon)
    record.replaceChildren()
    record.hidden = false
    var list = document.createElement('dl')
    function row(label, value) {
      if (!value) return
      var term = document.createElement('dt')
      term.textContent = label
      var detail = document.createElement('dd')
      detail.textContent = value
      list.append(term, detail)
    }
    row('Directory', door.listed ? 'Listed' : 'Removed after ${DELIST_AFTER} failed checks in a row')
    row('First passed', door.firstPassedAt && when(door.firstPassedAt))
    row('Last answered', door.lastAnsweredAt && when(door.lastAnsweredAt))
    row('Last checked', door.lastCheckedAt && when(door.lastCheckedAt))
    if (door.listed) row('Next question', door.nextAskAt && 'Around ' + when(door.nextAskAt))
    var again = action('Run a fresh check')
    again.addEventListener('click', run)
    record.append(list, again)
    status.textContent = door.listed
      ? door.domain + ' has a CAP front door. These are the results of its last check.'
      : door.domain + ' is no longer passing. Run a fresh check after fixing it.'
    showChecks(door.lastChecks || [])
    showShare(door.domain, door.listed, false)
  }

  function showChecks(checks) {
    results.replaceChildren()
    checks.forEach(function (check) {
      var item = document.createElement('li')
      item.dataset.pass = check.skipped ? 'skipped' : String(check.pass)
      var title = document.createElement('strong')
      title.textContent = check.title
      var state = document.createElement('span')
      state.className = 'check-state'
      state.textContent = stateText(check)
      var detail = document.createElement('p')
      detail.textContent = check.detail || ''
      item.append(title, state, detail)
      if (check.help) {
        var help = document.createElement('p')
        var link = document.createElement('a')
        link.href = check.help
        link.textContent = 'How to add agent.txt'
        help.append(link)
        item.append(help)
      }
      results.append(item)
    })
  }

  function stateText(check) {
    if (check.skipped) return 'Skipped'
    if (check.pass) return 'Passed'
    if (check.status === 404) return '404 Not found'
    if (check.status) return 'Failed (' + check.status + ')'
    return 'Failed'
  }

  function clearTimers() {
    timers.forEach(clearTimeout)
    timers = []
  }

  function focus(id, sentence) {
    status.textContent = sentence
    Array.prototype.forEach.call(results.children, function (item) {
      var on = item.dataset.id === id
      if (on) item.dataset.active = 'true'
      else delete item.dataset.active
      var state = item.querySelector('.check-state')
      if (state) state.textContent = on ? 'Checking' : 'Waiting'
    })
  }

  function showPending() {
    clearTimers()
    results.replaceChildren()
    steps.forEach(function (step) {
      var item = document.createElement('li')
      item.dataset.pass = 'pending'
      item.dataset.id = step[0]
      var title = document.createElement('strong')
      title.textContent = step[1]
      var state = document.createElement('span')
      state.className = 'check-state'
      state.textContent = 'Waiting'
      item.append(title, state)
      results.append(item)
    })
    var later = document.createElement('li')
    later.dataset.pass = 'pending'
    later.dataset.id = 'private'
    var laterTitle = document.createElement('strong')
    laterTitle.textContent = 'Private to the caller'
    var laterState = document.createElement('span')
    laterState.className = 'check-state'
    laterState.textContent = 'Waiting'
    later.append(laterTitle, laterState)
    results.append(later)
    focus(steps[0][0], steps[0][2])
    timers.push(setTimeout(function () { focus(steps[1][0], steps[1][2]) }, 2000))
    timers.push(setTimeout(function () { focus(steps[2][0], steps[2][2]) }, 4500))
  }

  function run() {
    button.disabled = true
    button.textContent = 'Checking'
    bar.hidden = false
    share.hidden = true
    share.replaceChildren()
    record.hidden = true
    record.replaceChildren()
    showSite('')
    showPending()
    fetch('/api/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: input.value })
    }).then(function (res) { return res.json() }).then(function (data) {
      results.replaceChildren()
      if (!data || !data.checks) {
        status.textContent = (data && data.error && data.error.message) || 'The check could not run.'
        return
      }
      if (data.domain) remember(data.domain)
      showSite(data.domain, data.icon)
      var sentence = data.passed ? 'This door passes.' : data.skipped ? 'The door was not asked this time. That is not counted as a failure.' : 'This door does not pass yet.'
      if (data.cached && data.checkedAt) sentence += ' Checked ' + minutesAgo(data.checkedAt) + '. Results are shared for ${RESULT_TTL_S / 60} minutes.'
      status.textContent = sentence
      showChecks(data.checks)
      var noDoor = data.checks.some(function (check) { return check.id === 'card' && !check.pass })
      if (data.domain) showShare(data.domain, data.passed, noDoor)
    }).catch(function () {
      results.replaceChildren()
      status.textContent = 'The check could not run.'
    }).then(function () {
      clearTimers()
      bar.hidden = true
      button.disabled = false
      button.textContent = 'Check'
    })
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault()
    run()
  })
  if (preset) {
    fetch('/api/door?domain=' + encodeURIComponent(preset))
      .then(function (res) { return res.ok ? res.json() : null })
      .then(function (door) { if (door && door.domain) showSaved(door); else run() })
      .catch(run)
  }
})()
</script>`
}

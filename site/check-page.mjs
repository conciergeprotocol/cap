import { CALLER, QUESTION } from './check.mjs'

export function checkPageBody() {
  return `<h1>Is your website CAP-able?</h1>
<p>Enter a domain. This page reads <code>agent.txt</code>, sends one public question, and reports what passed. The question is "${QUESTION}" from <code>${CALLER}</code>. Nothing is stored. The address keeps the domain, so the same check can be opened again.</p>
<form class="check-form">
<label for="domain">Domain</label>
<input id="domain" name="domain" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="example.com" required>
<button type="submit">Check</button>
</form>
<p class="check-status" role="status"></p>
<div class="check-bar" hidden><span></span></div>
<div class="check-site" hidden></div>
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

  function copyText(text, control, fallback) {
    var idle = control.textContent
    function done(ok) {
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

  function showShare(domain, passed) {
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
  }

  var badgeStyles = [
    ['badge.svg', 'Brand'],
    ['badge-light.svg', 'Light'],
    ['badge-dark.svg', 'Dark']
  ]

  function badgeSnippet(domain, file) {
    var door = 'https://' + domain + '/agent.txt'
    return '<p class="cap-badge">\\n' +
      '  <a href="https://conciergeprotocol.org/check?domain=' + encodeURIComponent(domain) + '"><img src="https://conciergeprotocol.org/' + file + '" width="140" height="20" alt="Agents welcome: this site answers AI agents through CAP"></a>\\n' +
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
    var code = document.createElement('pre')
    function pick(file) {
      code.textContent = badgeSnippet(domain, file)
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
      badge.width = 140
      badge.height = 20
      badge.alt = ''
      var label = document.createElement('span')
      label.textContent = style[1]
      option.append(badge, label)
      option.addEventListener('click', function () { pick(style[0]) })
      picker.append(option)
    })
    pick(badgeStyles[0][0])
    var copy = action('Copy badge HTML')
    copy.addEventListener('click', function () { copyText(code.textContent, copy, 'Select the HTML above') })
    var more = document.createElement('p')
    more.append('Keep the line visible. ')
    var guide = document.createElement('a')
    guide.href = '/publish#5-add-the-badge'
    guide.textContent = 'Why it is not hidden'
    more.append(guide, '.')
    block.append(title, picker, code, copy, more)
    return block
  }

  function showSite(domain) {
    site.replaceChildren()
    site.hidden = !domain
    if (!domain) return
    var icon = document.createElement('img')
    icon.src = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=64'
    icon.alt = ''
    icon.width = 24
    icon.height = 24
    icon.addEventListener('error', function () { icon.remove() })
    var name = document.createElement('span')
    name.textContent = domain
    site.append(icon, name)
  }

  function stateText(check) {
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
      showSite(data.domain)
      status.textContent = data.passed ? 'This door passes.' : 'This door does not pass yet.'
      data.checks.forEach(function (check) {
        var item = document.createElement('li')
        item.dataset.pass = String(check.pass)
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
      if (data.domain) showShare(data.domain, data.passed)
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
  if (preset) run()
})()
</script>`
}

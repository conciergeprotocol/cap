import { CALLER, QUESTION } from './check.mjs'

export function checkPageBody() {
  return `<h1>Check a door</h1>
<p>Enter a domain. This page reads <code>agent.txt</code>, sends one public question, and reports what passed. The question is "${QUESTION}" from <code>${CALLER}</code>. Nothing is stored.</p>
<form class="check-form">
<label for="domain">Domain</label>
<input id="domain" name="domain" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="cosmicjs.com" required>
<button type="submit">Check</button>
</form>
<p class="check-status" role="status"></p>
<ol class="check-results"></ol>
<script>
(function () {
  var form = document.querySelector('.check-form')
  var input = document.getElementById('domain')
  var status = document.querySelector('.check-status')
  var results = document.querySelector('.check-results')
  var button = form.querySelector('button')
  var preset = new URLSearchParams(location.search).get('domain')
  if (preset) input.value = preset
  form.addEventListener('submit', function (event) {
    event.preventDefault()
    button.disabled = true
    status.textContent = 'Checking.'
    results.replaceChildren()
    fetch('/api/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: input.value })
    }).then(function (res) { return res.json() }).then(function (data) {
      if (!data || !data.checks) {
        status.textContent = (data && data.error && data.error.message) || 'The check could not run.'
        return
      }
      status.textContent = data.passed ? 'This door passes.' : 'This door does not pass yet.'
      data.checks.forEach(function (check) {
        var item = document.createElement('li')
        item.dataset.pass = String(check.pass)
        var title = document.createElement('strong')
        title.textContent = check.title
        var state = document.createElement('span')
        state.className = 'check-state'
        state.textContent = check.pass ? 'Passed' : 'Failed'
        var detail = document.createElement('p')
        detail.textContent = check.detail || ''
        item.append(title, state, detail)
        results.append(item)
      })
    }).catch(function () {
      status.textContent = 'The check could not run.'
    }).then(function () {
      button.disabled = false
    })
  })
})()
</script>`
}

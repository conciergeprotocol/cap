// Replace this with the function your app already uses to answer a person.
// history is the earlier turns, oldest first. The caller does not resend them.
export async function answer({ message, history }) {
  const text = message.toLowerCase()
  if (history.length && text.includes('shorter')) return 'CAP is one file and two endpoints.'
  if (text.includes('cap') || text.includes('protocol')) {
    return 'CAP is a front door. A visiting agent reads agent.txt, sends a message, and your app answers with its own tools.'
  }
  return 'I can answer questions about CAP. Ask what it is.'
}

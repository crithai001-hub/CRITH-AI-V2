// ── content/shared/send-input.ts ──────────────────────────────
// Helpers for programmatically writing into a platform's input field
// and triggering the send action — used by the card's "Ask AI" button.
//
// React-controlled inputs (every modern chat UI) ignore direct
// `el.value = "x"` assignments because React tracks its own internal
// state. The `nativeInputValueSetter` pattern routes the value through
// the native HTMLTextAreaElement / HTMLInputElement setter so React
// sees an "input" event identical to one a real user would produce.
//
// For contenteditable inputs (newer ChatGPT, some others), we set
// innerText and dispatch an InputEvent with the right inputType so
// the React handler accepts it.

/**
 * Set the value of `input` to `value` in a way React notices.
 * Returns true on success, false if the element type is unsupported.
 */
export function setReactControlledValue(input: Element, value: string): boolean {
  if (input instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set
    if (setter) {
      setter.call(input, value)
    } else {
      input.value = value
    }
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }
  if (input instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    if (setter) {
      setter.call(input, value)
    } else {
      input.value = value
    }
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }
  if (input instanceof HTMLElement && input.isContentEditable) {
    // Contenteditable path. innerText preserves newlines; React listens
    // for InputEvent with inputType insertText to update its model.
    input.focus()
    input.innerText = value
    input.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: value,
      }),
    )
    return true
  }
  return false
}

/**
 * Click `button` programmatically. Returns true if the button is
 * present and not disabled.
 */
export function clickIfEnabled(button: HTMLButtonElement | null): boolean {
  if (!button) return false
  if (button.disabled) return false
  button.click()
  return true
}

/**
 * Helper for adapters: try each selector in order to find the input,
 * then set the value, then click the matching send button. The 100ms
 * delay between set + click gives React's render cycle time to mark
 * the send button enabled (it's typically disabled while the input
 * is empty).
 */
export async function setInputAndSend(
  inputSelectors: readonly string[],
  sendButtonSelectors: readonly string[],
  prompt: string,
): Promise<boolean> {
  let input: Element | null = null
  for (const sel of inputSelectors) {
    input = document.querySelector(sel)
    if (input) break
  }
  if (!input) {
    console.warn('[Crith V2] sendToInput: input not found, tried:', inputSelectors)
    return false
  }

  if (!setReactControlledValue(input, prompt)) {
    console.warn('[Crith V2] sendToInput: input element type unsupported', input)
    return false
  }

  // Wait briefly for React to enable the send button.
  await new Promise((resolve) => setTimeout(resolve, 120))

  let sendButton: HTMLButtonElement | null = null
  for (const sel of sendButtonSelectors) {
    const found = document.querySelector<HTMLButtonElement>(sel)
    if (found) {
      sendButton = found
      break
    }
  }
  if (!clickIfEnabled(sendButton)) {
    console.warn('[Crith V2] sendToInput: send button not clickable, tried:', sendButtonSelectors)
    return false
  }
  return true
}

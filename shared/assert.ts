// Power of 10 rule 5: a failed assertion stops the function that made a false assumption.
export function assert(condition: unknown, message: string): asserts condition {
  if (message.length === 0) {throw new Error('assertion failed: an assertion needs a message');}
  if (!condition) {throw new Error(`assertion failed: ${message}`);}
}

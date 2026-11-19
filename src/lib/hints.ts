/**
 * One line per page saying what it is for. Used in three places so they always match:
 * hover text on the sidebar (computer), the grey line in the phone's More menu, and the page subtitle.
 */
export const PAGE_HINTS = {
  '/desk': 'Hand items to students who come to collect.',
  '/receive': "Tick off items as the vendor's boxes arrive.",
  '/': 'Where this sales round stands, at a glance.',
  '/items': 'Every item ordered: search, fix details or change status.',
  '/inventory': 'How many of each colour and size, and where they are.',
  '/print': 'What to send the vendor: sizes and names for the back.',
  '/exports': 'Email lists of students, e.g. everyone whose item is ready.',
  '/import': 'Bring in orders from the Google Form file, or add one by hand.',
  '/activity': 'Every change: who did it, when, and what it was before.',
  '/products': 'Sales rounds and the items sold in each.',
  '/team': 'Who can sign in, and what each role can do.',
} as const

export type HintPath = keyof typeof PAGE_HINTS

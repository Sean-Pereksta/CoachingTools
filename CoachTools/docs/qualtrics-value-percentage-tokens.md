# Qualtrics rule-message percentage values

Existing `(StrengthValue)` and `(ConcernValue)` references keep their normal display formatting. `(OpportunityValue)` is also accepted as an alias for `(ConcernValue)`.

| Rule message reference | Underlying value | Message output |
| --- | ---: | ---: |
| `(StrengthValue%)` | 0.436 | 0.436% |
| `(OpportunityValue%)` | 0.436 | 0.436% |
| `(StrengthValue%100)` | 0.436 | 43.6% |
| `(OpportunityValue%100)` | 0.436 | 43.6% |

The modifier can also follow the closing parenthesis, such as `(StrengthValue)%100`. Bare `StrengthValue%`, `StrengthValue%100`, `OpportunityValue%`, and `OpportunityValue%100` work too. Names are case-insensitive. The same modifiers work on `ConcernValue` and on parenthesized custom numeric variables.

Explicit formats use each finding's underlying numeric observation, not its previously formatted display string. A raw 43.6 is therefore 43.6% with `%`, or 4360% with `%100`. A numeric observation of 0.436 already displayed as 43.6% is still 43.6% with `%100`, never 4360%. Literal percent strings are parsed as fractions. Zero remains 0%; missing outcomes remain blank or N/A rather than becoming 0%. Non-numeric values and unsupported modifiers produce a template error and prevent send readiness.

These formats apply to rule messages, headers, headings, footers, and generic message text in both synchronous previews and chunked mass-message generation. No saved-rule migration is needed. Floating-point noise is trimmed to 12 significant digits.

Regression coverage: `node apps/allstar/tests/individual-message-percentage-tokens.test.js` after `node apps/allstar/build/build-portable.js`. This test is included in `npm run test:allstar` and `npm test`.

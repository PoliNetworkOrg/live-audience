# Number lottery

Participants sign in, submit a display name and one integer from 0 to 100, and may
replace their guess until the presenter draws. Closest absolute distance wins.
Equal distances trigger a random draw of one winner among the tied entries, explicitly
announced on the participant page and presentation before the winner is revealed.
Same names or guesses are separate chances when submitted by different accounts.

The `number-lottery` activity uses existing validation, response storage and registries.
The API-key/admin endpoint `POST /activities/:slug/draw` generates a uniform integer
with Node `randomInt(0, 101)` and randomly selects one closest entry. It accepts no
caller-supplied target. Closing the stage and persisting the outcome in SQLite settings
are one transaction. Repeated requests return the stored outcome, including after restart.
Reopening is refused until the existing reset endpoint deletes responses and the outcome.
Deleting an activity also deletes its saved outcome. No migration or dependency is needed.
Submitted display names and guesses are presentation data; account identifiers remain private.

Results are `{ prompt, totalParticipants, entries: [{ name, number }], draw }`, where draw
is null before extraction or `{ number, distance, closest, winners, drawnAt }` afterward.
The existing SSE results feed carries that outcome. Presentation animation is decorative:
it reveals the saved server result, never generates a second outcome. Reload restores it.

Implementation and checks:
1. Definition/UI, persisted draw endpoint, reopening/reset/delete lifecycle; verify integer
   boundaries, closest distance, ties, permissions, late changes and draw idempotence.
2. Add a gadget lottery slide to both assembly decks, including the tie announcement and
   a lottery-ball animation. Preserve the existing wheel and other slide content.
3. Verify browser entry/draw/reload/tie flows, both deck layouts, and the app's required
   `pnpm typecheck && pnpm check && pnpm test`, followed by a build.

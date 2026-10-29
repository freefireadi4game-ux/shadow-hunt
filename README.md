# Shadow Hunt

BUILD SHADOW HUNT — REAL-LIFE MULTIPLAYER MANHUNT GAME



Build a complete, mobile-first, real-world GPS multiplayer hunting game called SHADOW HUNT, inspired by IRL Manhunt games. This must be a functional multiplayer application, not just a UI prototype.



Use React, TypeScript, Tailwind CSS, Supabase Authentication, PostgreSQL, Realtime and secure server-side game logic. Integrate a real GPS map using a suitable map provider. All players must be able to join the same match from their own phones and receive synchronized game updates.



1. GAME MODES AND ROLES



Create private matches using room codes or invitations.



- Hunters / Seekers: Find and catch all Shadow players before the match ends.

- Shadows / Runners: Evade Hunters, stay inside the safe zone and survive until the timer ends.

- The host can assign roles manually or randomly.

- Every player must have a unique identity, username, role and player status.

- Display all players in the lobby before the host starts the match.



2. MATCH SETTINGS — HOST CONFIGURABLE



Create a match settings screen where the host can configure:



- Total match duration: default 60 minutes.

- Shadow location ping interval: default every 3 minutes.

- Hunter location reveal interval: default every 5 minutes.

- Safe zone shrink interval: default every 10 minutes.

- Initial safe zone radius and minimum radius.

- Number of Hunters and Shadows.

- Capture confirmation method.

- Match start countdown and optional grace period.

- Optional maximum number of location reveals per player.



Allow the host to adjust these settings before the match starts. Show the selected settings to all players. Once the match begins, lock critical settings unless the host explicitly enables a fair mid-match adjustment.



3. SHADOW LOCATION PINGS



- Every 3 minutes by default, reveal each active Shadow's latest valid GPS position to the Hunters.

- Show the ping countdown on the Hunter's screen.

- Before a ping, Hunters can see only the last revealed position, clearly marked as stale.

- After a ping, update the map with a timestamp and an indication of location accuracy.

- Do not continuously expose live Shadow coordinates between scheduled pings.

- Allow the host to change the interval before the match.

- If GPS is unavailable, show "Location unavailable" rather than inventing a position.

- Notify Hunters when a new ping becomes available.



4. HUNTER LOCATION REVEALS



- Every 5 minutes by default, reveal the Hunters' positions to the Shadows.

- Shadows can see the most recent revealed Hunter locations on their map.

- Show the next reveal countdown.

- Between reveals, retain only the previous revealed positions.

- Allow the host to adjust the interval.

- Never display a Hunter's supposedly live position when only an older location is available.



5. FOUND / CAPTURE SYSTEM



Every player must have a prominent FOUND button on their phone.



When a Hunter physically finds a Shadow:



1. The Hunter must immediately open the app and tap FOUND.

2. Display a confirmation screen to prevent accidental reports.

3. The Hunter selects the Shadow they found.

4. The server records the report with player IDs, match ID and server timestamp.

5. The Shadow receives a capture confirmation request.

6. The Shadow can confirm or dispute the capture according to the match rules.

7. After a confirmed capture, mark the Shadow as captured and exclude them from active-player tracking.

8. Notify all relevant players and update the match leaderboard.



Provide a configurable alternative where the host or referee can verify captures. Prevent duplicate reports, self-captures and reports against already captured players.



A FOUND report alone must not automatically count as a verified capture unless the host has explicitly selected that rule.



6. SAFE ZONE AND SHRINKING CIRCLE



- Display a real-world map with a circular safe zone.

- Default shrink interval: every 10 minutes.

- Start with a host-defined radius and gradually reduce it toward a minimum radius.

- Display the next shrink countdown.

- Show the safe-zone boundary clearly.

- Warn players before the zone shrinks.

- Notify players when they are outside the safe zone.

- Apply configurable penalties, such as losing survival points or becoming temporarily vulnerable.

- Keep zone calculations and transitions synchronized through server-authoritative game state.

- Never move the zone unpredictably or shrink it without notifying players.

- Do not design the zone to require players to enter dangerous roads, restricted property or unsafe locations.



7. MATCH TIMER AND WIN CONDITIONS



Default duration: 60 minutes.



- The countdown begins only when the host starts the match.

- The timer must be calculated from server timestamps, not individual phone clocks.

- Pause and resume are host-controlled, logged actions.

- If every Shadow is captured, Hunters win immediately.

- If at least one Shadow survives until the match timer reaches zero, Shadows win.

- If all players disconnect or GPS becomes unavailable, do not silently award a win.

- Display a clear victory or defeat screen with match statistics.



8. MAP AND RADAR INTERFACE



Create a premium dark tactical interface with neon green, orange and purple accents.



Include:



- Real street map.

- Safe-zone circle.

- Hunter and Shadow markers.

- Last-known location markers and timestamps.

- Ping countdown and next reveal countdown.

- Player compass or directional radar where supported.

- Current role and active player count.

- Match timer and zone timer.

- GPS accuracy indicator.

- Clear warnings for stale or missing locations.



Use different icons and colors for Hunters, active Shadows, captured players and safe-zone boundaries. Include a map legend and accessible controls.



9. ADDITIONAL GAME RULES



Implement these as configurable match options:



- Grace period: Give players 2 minutes to spread out before hunting begins.

- Fair start: No capture during the grace period.

- Safe-zone warning: Warn players 60 seconds before every scheduled shrink.

- Disconnect handling: Show disconnected players and allow a configurable reconnection period.

- GPS integrity: Flag suspiciously inaccurate or impossible location jumps for review instead of automatically accusing players of cheating.

- No teleporting: Reject invalid or implausible location updates server-side.

- Anti-spam: Rate-limit FOUND reports and repeated actions.

- Emergency stop: Every player has an emergency exit or safety button. It immediately stops their participation and informs the host.

- Fair play: No tackling, physical contact, blocking traffic, entering private property or trespassing.

- Match log: Record starts, pauses, pings, reveals, captures, zone changes and results.

- Rematch: Allow the host to create a new match with the same players and settings.



10. LOBBY AND MULTIPLAYER FEATURES



Build:



- Create Match.

- Join Match with room code.

- Invite friends.

- Lobby with player list and role assignments.

- Ready / Not Ready status.

- Host controls.

- Match settings.

- Live match screen.

- Results screen.

- Recent match history.

- Player statistics and wins.



Use Supabase Realtime for synchronized events and database-backed state. Implement server-side validation and access control so a Shadow cannot read other Shadows' hidden coordinates and players cannot modify their own role, capture status or match timer.



11. DATABASE AND SECURITY



Create a proper Supabase schema for:



- Profiles

- Matches

- Match participants

- Match settings

- Latest GPS positions

- Scheduled location reveals

- Capture reports

- Safe-zone state

- Match event logs

- Match results



Store private GPS information separately from public player information. Enforce Row Level Security (RLS) and authorize location visibility on the server. Never expose the Supabase service-role key in the frontend.



Use server-controlled timestamps and transitions. Prevent clients from querying unrevealed coordinates directly through database tables or Realtime subscriptions.



12. MOBILE EXPERIENCE



- Optimize for Android phones first.

- Use responsive, touch-friendly layouts.

- Support GPS permission requests and permission-denied states.

- Display clear location-sharing and privacy controls.

- Show network connection status.

- Handle app backgrounding and reconnection gracefully.

- Do not claim that GPS will update reliably in the background unless the platform supports it.

- Provide a PWA installation option and explain any limitations of background location tracking.

- Provide a native Android upgrade path if reliable background GPS is required.



13. DESIGN QUALITY



Create an immersive tactical hunting-game aesthetic with:



- OLED-friendly dark backgrounds.

- Neon green for safe/active states.

- Orange for warnings and upcoming events.

- Purple for special actions.

- Smooth countdown animations and radar sweeps.

- Premium cards, subtle borders and clear typography.

- Clean layouts optimized for outdoor use and sunlight readability.



Avoid excessive animations that hide critical information or drain the battery.



14. BUILD REQUIREMENTS



Build the actual application in working phases:



1. Authentication and lobby.

2. Room creation and joining.

3. Roles and match settings.

4. GPS permission and map.

5. Server-controlled location pings and Hunter reveals.

6. Safe-zone shrink system.

7. FOUND and capture verification.

8. Match timer and victory conditions.

9. Security, reconnect handling and testing.



Do not simulate GPS positions in production. Clearly label any demo data.



Before completion, test two or more real devices joining the same match, verify location visibility rules, confirm that timer changes synchronize, and test disconnects, captures, safe-zone transitions and match completion.



Final objective: Deliver a working, secure, real-world multiplayer GPS Manhunt game that friends can play together using their own phones. Prioritize correct game mechanics, fair play, GPS privacy, server-side validation and reliable synchronization over decorative UI.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ef7fc1e8-599e-4a7a-ae87-3a94f8ef2276).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

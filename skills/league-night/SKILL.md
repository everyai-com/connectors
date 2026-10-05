---
name: league-night
description: Onboard the user to LeagueNight - fixtures, standings, match-day plans and season planning.
---

# LeagueNight quick start

LeagueNight does the schedule maths for sports leagues. It never stores anything
and never contacts anyone.

Suggested flow:

1. Ask which job the organizer wants: fixtures, standings, a match-day plan or a
   full season plan.
2. `round_robin_schedule` for the fixture list (2-100 teams; odd counts get one
   bye per round; set `second_leg` for home-and-away).
3. `standings_table` to turn match results into a table - pass the full roster in
   `teams` to include teams with no results yet, and set `points_win`/`points_draw`
   if the league is not 3/1.
4. `match_day_plan` to lay games across courts and time slots; `season_plan` to
   size the season and get the match dates and estimated finish date.
5. Relay the fixtures, table or timeline back to the organizer; they run the
   league - LeagueNight only computes.

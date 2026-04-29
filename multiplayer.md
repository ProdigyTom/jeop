## Multiplayer feature

### Description
I want to add a multiplayer feature where multiple users can compete against each other from their own devices. there will be options to create or join a game under a multiplayer heading on the main screen. One player will start a multiplayer game, choose some settings and give the other players a code (maybe show them a QR code too?) to join. When players join the game they will be asked to enter their name to use as a display name for leaderboards etc. The players will answer questions on their own devices and get money based on the dollar value of the questions combined with how quickly they answered correctly. After each question players will be shown a list of the answers each player gave, who was correct and how much they earned. After each round the players will be shown a leaderboard with the players sorted by how much money they have. 
One of the setting will be whether to play a "final jeopardy" round. In this round the players will be shown the category of the question first, and based on the category they can make a wager (anywhere from $0 to their current total), if they get the question correct the amount is added to their total, if they get it wrong the amount is taken away from their total.

### details
- No auth required for multiplayer, just entere a display name
- 10 players max

### Settings
The player who starts the game will have to choose some settings:
- How many rounds (1-5)
- How many question per round (3-10)
- Will there be a final jeopardy round
- The player who started the game can optionally choose to "watch" so that it can be shown on a screen to everyone and show live stats about the game

### tech choices
- ~I am thinking web sockets would be a good choice for this but let me know if there is a better suggestion.~ We are going to use Supabase Realtime Broadcast for this
- If we can have the QR code to make it easy for users to join the game that would be ideal, but a game code entered to join is fine if that won't work.
- Nothing about this needs to be saved in the DB, we will keep the data around for the duration of the game and then it can all be thrown out.
- Host pre-fetches all rounds before the first question starts, so there's no wait between rounds.

### Questions
- The question interface for the normal rounds should look fairly similar to the one for the current single player mode, and we will use the same pool of questions.
- Questions will be randomly chosen from any category, the dollar amounts should increase througout each round but the category can be different for each question. Repeating dollar amounts is fine but they should generally increase overan individual round. So a a round of 10 questions might be: $200, $200, $400, $400, $600, $600, $800, $800, $1000, $1000 
- Users will be shown the same question at the same time, and shown a "waiting for other players" message if they finish early (cannot change answer once it is submitted).
- Once all user's answers have been submitted or the time runs out we can move on
- They will have 30 seconds to answer, if they answer in the first 10 seconds they get the full dollar amount for the question. After 10 seconds the dollar amount begins to go down until it hits %25 of the original dollar amount for the question which will be the minimum the user can get for a correct answer.

### Final jeopardy
- Final jeopardy questions can be from any category but should always be the highest dollar amount from the category
- Users will be shown the category for Final jeopardy before making their wagers, they will have 20 seconds to make a wager
- Users will have 1 minute to answer the final jeopardy question
- they gain or lose the amount wagered based on if they get the question correct or not

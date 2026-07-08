// Sample wishes — phrased to follow the prompt "Before AI steals my job…"
const SAMPLE_NOTES = [
  { id: 'n1',  text: "I will make as much money as I can",             author: "Jules",   hours: 2,    plus: 142 },
  { id: 'n2',  text: "I hope I can retire",                            author: null,      hours: 5,    plus: 89  },
  { id: 'n3',  text: "I want to ship one last big project",            author: "M.",      hours: 9,    plus: 2300 },
  { id: 'n4',  text: "I want to finally ask for a raise",              author: null,      hours: 14,   plus: 421 },
  { id: 'n5',  text: "I want to feel useful one more time",            author: "Plato",   hours: 22,   plus: 612 },
  { id: 'n6',  text: "I want to pay off the mortgage",                 author: null,      hours: 30,   plus: 73  },
  { id: 'n7',  text: "I want to learn a trade with my hands",          author: "Rina",    hours: 33,   plus: 187 },
  { id: 'n8',  text: "one last all-nighter with my team",              author: null,      hours: 41,   plus: 2541 },
  { id: 'n9',  text: "I want to stop refreshing AI news",              author: "k.",      hours: 48,   plus: 998 },
  { id: 'n10', text: "I want to max out my 401k",                      author: null,      hours: 60,   plus: 1804 },
  { id: 'n11', text: "finish the course I keep abandoning",            author: "Esme",    hours: 66,   plus: 244 },
  { id: 'n12', text: "I want to get one more bonus",                   author: null,      hours: 72,   plus: 3210 },
  { id: 'n13', text: "I want to sleep before a deadline",              author: null,      hours: 80,   plus: 56  },
  { id: 'n14', text: "I want to build a side business",                author: "T.",      hours: 88,   plus: 412 },
  { id: 'n15', text: "I want to quit out loud, just once",             author: null,      hours: 96,   plus: 1670 },
  { id: 'n16', text: "I want to go back to the office",                author: "Andrei",  hours: 104,  plus: 318 },
  { id: 'n17', text: "I want to make peace with the machines",         author: null,      hours: 112,  plus: 2890 },
  { id: 'n18', text: "watch my intern become my boss",                 author: "the boss", hours: 120, plus: 4112 },
  { id: 'n19', text: "stop being afraid of layoffs",                   author: null,      hours: 130,  plus: 1241 },
  { id: 'n20', text: "I want to code one more feature",                author: "Lou",     hours: 145,  plus: 503 },
  { id: 'n21', text: "I want to see a data center",                    author: null,      hours: 160,  plus: 88  },
  { id: 'n22', text: "I want to tell my boss the truth",               author: null,      hours: 178,  plus: 2670 },
  { id: 'n23', text: "I want to be employee of the month",             author: "Sam",     hours: 200,  plus: 3344 },
  { id: 'n24', text: "build something no AI can copy",                 author: null,      hours: 220,  plus: 1102 },
  { id: 'n25', text: "I want to forgive the algorithm",                author: null,      hours: 244,  plus: 5210 },
  { id: 'n26', text: "drive a truck across the country",               author: "J.K.",    hours: 260,  plus: 470 },
  { id: 'n27', text: "find out what the board knows",                  author: null,      hours: 280,  plus: 199 },
  { id: 'n28', text: "I want to see my equity vest",                   author: "Aanya",   hours: 300,  plus: 624 },
  { id: 'n29', text: "make my manager proud",                          author: null,      hours: 330,  plus: 2812 },
  { id: 'n30', text: "stop checking Slack in bed",                     author: null,      hours: 360,  plus: 711 },
  { id: 'n31', text: "I want to learn to say no to meetings",          author: "Mira",    hours: 400,  plus: 1450 },
  { id: 'n32', text: "drink wine at a work lunch",                     author: null,      hours: 440,  plus: 388 },
  { id: 'n33', text: "I want to dance at the holiday party",           author: null,      hours: 460,  plus: 612 },
  { id: 'n34', text: "I want to call my old coworker",                 author: null,      hours: 480,  plus: 388 },
  { id: 'n35', text: "I want to mentor a junior again",                author: null,      hours: 500,  plus: 920 },
  { id: 'n36', text: "I want to be unafraid of the demo",              author: null,      hours: 520,  plus: 1580 },
  { id: 'n37', text: "I want to work from a foreign city",             author: null,      hours: 540,  plus: 712 },
  { id: 'n38', text: "I want to see my pension",                       author: "p.",      hours: 560,  plus: 1432 },
  { id: 'n39', text: "I want to clear my inbox, just once",            author: null,      hours: 580,  plus: 388 },
  { id: 'n40', text: "I want to love Mondays again",                   author: null,      hours: 600,  plus: 821 },
  // Long entries — truncated to 30 chars with … in the floater, full text shown when expanded
  { id: 'n41', text: "I want to write the resignation letter I've been drafting in my head for years and finally send it",      author: "R.",      hours: 620,  plus: 1430 },
  { id: 'n42', text: "I want to spend an entire workday doing absolutely nothing without feeling guilty about it",              author: null,      hours: 640,  plus: 902 },
  { id: 'n43', text: "I want to learn how to actually listen in meetings, the way my first boss listened, before it's all transcripts", author: "Theo", hours: 660, plus: 2241 },
  { id: 'n44', text: "I want to apologize properly to the teammate I blamed in 2018 because I was scared for my job",           author: null,      hours: 680,  plus: 1188 },
  { id: 'n45', text: "I want to hear my team laugh until they cry, the kind of laugh we had before the restructuring happened", author: null,      hours: 700,  plus: 3104 },
  { id: 'n46', text: "I want to walk into an interview totally unprepared and get the job purely on charm",                     author: "Liv",     hours: 720,  plus: 514 },
];

// SAMPLE_NOTES is the offline FALLBACK. When /api/wall returns real notes,
// app.js rebuilds the rows from those instead. See buildRows() below.
const FALLBACK_NOTES = SAMPLE_NOTES;

// Rows are centered vertically. dyPx = pixel offset from viewport vertical center.
// Default stride between rows (top-to-top) = 24px gap + 44px floater height.
const ROW_STRIDE = 24 + 44;

// Build the drift layout from any array of notes (each needs an `id`).
// rowCount + stride are viewport-dependent (fewer, tighter rows on mobile).
function buildRows(notes, rowCount = 10, stride = ROW_STRIDE) {
  const out = [];
  const speeds = [220, 240, 200, 260, 210, 230, 190, 250, 215, 245];
  const noteIds = (notes && notes.length ? notes : FALLBACK_NOTES).map((n) => n.id);
  const mid = (rowCount - 1) / 2; // centers the rows around the viewport middle
  for (let i = 0; i < rowCount; i++) {
    const dir = (i % 2 === 0) ? 1 : -1;
    const start = (i * 4) % noteIds.length;
    const ids = [];
    for (let j = 0; j < 4; j++) ids.push(noteIds[(start + j) % noteIds.length]);
    out.push({ dyPx: (i - mid) * stride, dir, speed: speeds[i % speeds.length], notes: ids });
  }
  return out;
}

// Initial layout uses the fallback; replaced once the API responds.
let ROWS = buildRows(FALLBACK_NOTES);

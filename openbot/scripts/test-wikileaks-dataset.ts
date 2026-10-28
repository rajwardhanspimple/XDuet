import { readFile } from 'node:fs/promises';
import { DeciderInferenceEngine } from '../server/src/decision/inference';

async function main() {
  const nanoWeights = JSON.parse(await readFile('models/opendecider-nano/weights.json', 'utf8'));
  const nano = new DeciderInferenceEngine(nanoWeights);

  const testCases = [
    // --- REAL WIKILEAKS EMAILS (ACTIONABLE TODAY) ---
    {
      id: 'wl-hrc-clear-syria',
      desc: 'Diplomatic Clearance: Jake Sullivan to HRC requesting statement clearance ("PLS CLEAR: STATEMENT ON SYRIA")',
      from: 'Jake Sullivan <sullivanjj@state.gov>',
      subject: 'PLS CLEAR: STATEMENT ON SYRIA',
      body: 'Fyi - ok? Statement on Syria draft attached for your review and sign-off before today\'s press conference.',
      expected: 1
    },
    {
      id: 'wl-hrc-call-turkey',
      desc: 'High-level travel call: Sidney Blumenthal ("PLS CALL BEFORE YOU LEAVE FOR TURKEY. IMPORTANT RE YOUR TRIP")',
      from: 'Sidney Blumenthal',
      subject: 'H: PLS CALL BEFORE YOU LEAVE FOR TURKEY. IMPORTANT RE YOUR TRIP. SID',
      body: 'H: Pls call before you leave for Turkey. Important information re your trip and meetings with foreign minister.',
      expected: 1
    },
    {
      id: 'wl-hrc-talk-tonight',
      desc: 'Direct principal sync request: "CAN WE TALK TONIGHT OR TOMORROW AM?"',
      from: 'Hillary Clinton',
      subject: 'CAN WE TALK TONIGHT OR TOMORROW AM?',
      body: 'Can we talk tonight or tomorrow am regarding the draft agenda and personnel appointments?',
      expected: 1
    },
    {
      id: 'wl-hrc-are-you-here',
      desc: 'Immediate in-office coordination: Huma Abedin ("ARE YOU STILL HERE")',
      from: 'Huma Abedin <abedinh@state.gov>',
      subject: 'ARE YOU STILL HERE',
      body: 'Are you still here in the office? Need to hand you the updated diplomatic cables before departure.',
      expected: 1
    },
    {
      id: 'wl-hrc-talk-before-bryan',
      desc: 'Pre-meeting call prep: "Can we talk before call w Bryan? I\'m free after this call"',
      from: 'Huma Abedin',
      subject: 'Can we talk before call w Bryan? I\'m free after this call-- if it happens since I\'m having much trouble w my phones again',
      body: 'Sorry just seeing this. Calling soon. Can we talk before the 2 PM conference call with Bryan?',
      expected: 1
    },
    {
      id: 'wl-hrc-call-ops',
      desc: 'Ops call request: "Can you pls call me thru ops?"',
      from: 'Hillary Clinton',
      subject: 'IGNATIUS',
      body: 'Ok. Can you pls call me thru ops as soon as you get a chance today?',
      expected: 1
    },
    {
      id: 'wl-hrc-call-south-korea',
      desc: 'Foreign Minister call: "CALL TMW WITH SOUTH KOREAN MINISTER KIM SUNG-HWAN"',
      from: 'Lauren Jiloty',
      subject: 'CALL TMW WITH SOUTH KOREAN MINISTER KIM SUNG-HWAN',
      body: 'Confirmed bilateral call tomorrow morning with South Korean Minister Kim Sung-Hwan. Call sheet attached.',
      expected: 1
    },
    {
      id: 'wl-hrc-davutoglu-today',
      desc: 'Foreign Minister urgent call: "FM DAVUTOGLU HAS REQUESTED TO SPEAK WITH YOU TODAY"',
      from: 'Monica Hanley',
      subject: 'FM DAVUTOGLU HAS REQUESTED TO SPEAK WITH YOU TODAY',
      body: 'Foreign Minister Davutoglu has urgently requested to speak with you today regarding cross-border negotiations.',
      expected: 1
    },
    {
      id: 'wl-hrc-call-eod',
      desc: 'Chief of Staff urgent sync: Cheryl Mills ("CALL ME AAT END OF YOUR DAY")',
      from: 'Cheryl Mills',
      subject: 'CALL ME AAT END OF YOUR DAY',
      body: 'Please call me at the end of your day. Need to discuss the congressional inquiry response.',
      expected: 1
    },

    // --- REAL WIKILEAKS EMAILS (INFORMATIONAL / CAN WAIT) ---
    {
      id: 'wl-hrc-news-murtha',
      desc: 'AP News Wire Report: Death of Rep. John Murtha (informational news bulletin)',
      from: 'Huma Abedin',
      subject: '(AP) REP JOHN MURTHA OF PA. DIES AT 77',
      body: 'UNCLASSIFIED U.S. Department of State Case No. F-2014-20439. Associated Press bulletin: Rep. John Murtha has passed away at age 77 following surgical complications.',
      expected: 0
    },
    {
      id: 'wl-hrc-radio-haiti',
      desc: 'Diplomatic Signal FM Broadcast Readout: Haiti Baby Doc return (informational)',
      from: 'Cheryl Mills',
      subject: 'SIGNAL FM CONFIRMS ITS BABY DOC',
      body: 'UNCLASSIFIED U.S. Department of State Case No. F-2014-20439. Signal FM in Port-au-Prince confirms former president Jean-Claude Duvalier has arrived on Air France flight.',
      expected: 0
    },
    {
      id: 'wl-hrc-memo-karzai',
      desc: 'Background briefing readout: Meeting with President Karzai (informational)',
      from: 'Hillary Clinton',
      subject: 'Karzai meeting',
      body: 'UNCLASSIFIED U.S. Department of State Case No. F-2016-07895. Background summary of bilateral talks in Kabul. For records and briefing archive.',
      expected: 0
    },
    {
      id: 'wl-hrc-bio-wolpe',
      desc: 'Biographical dossier readout: Special Envoy Wolpe (reference document)',
      from: 'Huma Abedin',
      subject: 'WOLPE',
      body: 'UNCLASSIFIED U.S. Department of State Case No. F-2014-20439. Biography and career history of Howard Wolpe, Presidential Special Envoy to Great Lakes Region.',
      expected: 0
    },
    {
      id: 'wl-hrc-strategy-germany',
      desc: 'Long-term Public Diplomacy Strategy: PA Germany Restructuring (reference memo)',
      from: 'Judith McHale',
      subject: 'PA GERMANY RESTRUCTURING',
      body: 'UNCLASSIFIED U.S. Department of State Case No. F-2014-20439. Attached is our 10-page strategic assessment for public affairs staffing in Berlin and Frankfurt over FY2012.',
      expected: 0
    },
    {
      id: 'wl-hrc-oped-iran',
      desc: 'Op-ed commentary forward: Gary Sick analysis on Iran (background reading)',
      from: 'Lauren Jiloty',
      subject: 'H: VERY GOOD ANALYSIS OF IRAN FROM GARY SICK, I THINK. SID',
      body: 'UNCLASSIFIED U.S. Department of State Case No. F-2014-20439. Forwarded article from Foreign Policy magazine by Gary Sick analyzing Iranian domestic political factions.',
      expected: 0
    }
  ];

  console.log(`TESTING ${testCases.length} WIKILEAKS DUMP BENCHMARK EMAILS AGAINST CURRENT MODEL:\n`);
  let passCount = 0;
  let failCount = 0;
  const failures: any[] = [];

  for (const tc of testCases) {
    const res = nano.predict(
      { subject: tc.subject, body: tc.body, headers: { From: tc.from } },
      { needs_you: { type: 'noul', instructions: 'Does this email require direct action today?' } }
    );
    const pred = res.needs_you.noul >= 0.5 ? 1 : 0;
    const pass = pred === tc.expected;
    if (pass) {
      passCount++;
    } else {
      failCount++;
      failures.push({ id: tc.id, desc: tc.desc, expected: tc.expected, got: pred, prob: res.needs_you.noul });
    }
    console.log(pass ? '[PASS]' : '[FAIL]', tc.desc);
    console.log(`       expected: ${tc.expected}, got: ${pred} (prob: ${res.needs_you.noul})`);
  }

  console.log(`\n================================================================================`);
  console.log(`SUMMARY: ${passCount} PASSED, ${failCount} FAILED out of ${testCases.length}`);
  console.log(`================================================================================`);
  if (failures.length > 0) {
    console.log(`FAILURES IDENTIFIED:`);
    for (const f of failures) {
      console.log(` - [${f.id}] ${f.desc}`);
      console.log(`   Expected: ${f.expected}, Got: ${f.got} (prob: ${f.prob})`);
    }
  }
}

main();


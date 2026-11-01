/*
 * library-data.js - the bundled starter hands, shipped with the app.
 * A classic script that defines data, so it also works when index.html is
 * opened from disk (a page opened from file:// cannot fetch() local files).
 * Same format as library/library.json (see library.js), but with the PBN text
 * inline ("pbn") instead of a file "path". Load it after library.js.
 * Keep it in step with library/starter-hands.pbn (tests-library.html checks).
 */
window.BridgeLibraryData = {
  format: 'bridge-practice-library',
  version: 1,
  title: 'Starter hands',
  files: [
    {
      title: 'Four starter hands',
      pbn: [
        '[Dealer "N"]',
        '[Vulnerable "None"]',
        '[Deal "N:AK42.A53.K63.874 976.T86.T872.QT9 Q53.KQ4.AQ4.A652 JT8.J972.J95.KJ3"]',
        '[Contract "3NT"]',
        '[Declarer "S"]',
        '',
        '[Dealer "S"]',
        '[Vulnerable "EW"]',
        '[Deal "N:Q973.A64.K54.K43 T6.JT8.QJ9.QJT98 AKJ84.KQ5.A32.76 52.9732.T876.A52"]',
        '[Auction "S"]',
        '1S Pass 3S Pass',
        '4S Pass Pass Pass',
        '[Contract "4S"]',
        '[Declarer "S"]',
        '',
        '[Dealer "N"]',
        '[Vulnerable "NS"]',
        '[Deal "N:AKQJ2.AK3.AQ5.A5 T98.JT98.KT8.QT7 543.Q42.432.K643 76.765.J976.J982"]',
        '[Contract "6NT"]',
        '[Declarer "N"]',
        '',
        '[Dealer "E"]',
        '[Vulnerable "All"]',
        '[Deal "N:AJ87.T6.K94.Q972 K52.AKJ85.Q63.A4 QT9.93.JT87.JT85 643.Q742.A52.K63"]',
        '[Auction "E"]',
        '1H Pass 3H Pass',
        '4H Pass Pass Pass',
        '[Contract "4H"]',
        '[Declarer "E"]',
        ''
      ].join('\n'),
      hands: [
        { title: 'Starter hand 1', note: 'nine top tricks plus the club ace' },
        { title: 'Starter hand 2', note: 'straightforward, ten or eleven tricks' },
        { title: 'Starter hand 3', note: 'hard: needs the diamond finesse' },
        { title: 'Starter hand 4', note: 'declarer is not South' }
      ]
    }
  ]
};

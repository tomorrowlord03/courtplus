import { describe, expect, it } from 'vitest';
import {
  BUILTIN_GUIDES,
  getAllGuideIds,
  getGuideById,
  matchGuides,
  normaliseText,
  tokenise,
} from '../src/index.js';

describe('Court+ Citizen Guides Matcher', () => {
  describe('Metadata and Builtin Catalog', () => {
    it('loads all 14 required legal topics in catalog', () => {
      const ids = getAllGuideIds();
      expect(ids.length).toBeGreaterThanOrEqual(14);
      expect(ids).toContain('road-accident');
      expect(ids).toContain('police-refuses-fir');
      expect(ids).toContain('domestic-violence');
      expect(ids).toContain('dowry-cruelty');
      expect(ids).toContain('cheque-bounce');
      expect(ids).toContain('consumer-complaint');
      expect(ids).toContain('cybercrime-fraud');
      expect(ids).toContain('unpaid-wages');
      expect(ids).toContain('tenant-landlord');
      expect(ids).toContain('property-land-dispute');
      expect(ids).toContain('arrest-rights');
      expect(ids).toContain('free-legal-aid');
      expect(ids).toContain('maintenance');
      expect(ids).toContain('workplace-sexual-harassment');
    });

    it('each guide contains complete required fields and valid laws', () => {
      for (const guide of BUILTIN_GUIDES) {
        expect(guide.id).toBeTruthy();
        expect(guide.title_en).toBeTruthy();
        expect(guide.title_hi).toBeTruthy();
        expect(guide.keywords_en.length).toBeGreaterThanOrEqual(5);
        expect(guide.keywords_hi.length).toBeGreaterThanOrEqual(5);
        expect(guide.laws.length).toBeGreaterThanOrEqual(1);
        expect(guide.steps.length).toBeGreaterThanOrEqual(2);
        expect(guide.helplines.length).toBeGreaterThanOrEqual(1);
        expect(guide.free_legal_aid).toBeDefined();
        expect(guide.free_legal_aid.eligible).toBeTruthy();
        expect(guide.when_to_see_a_lawyer.length).toBeGreaterThanOrEqual(1);
        expect(guide.sources.length).toBeGreaterThanOrEqual(1);
        expect(guide.last_checked).toBe('2026-11-23');
        expect(guide.hi_reviewed).toBe(false);

        for (const law of guide.laws) {
          expect(law.act).toBeTruthy();
          expect(law.section).toBeTruthy();
          expect(law.plain_meaning).toBeTruthy();
          expect(law.source_url).toMatch(/^https?:\/\//);
        }
      }
    });

    it('retrieves specific guide by ID', () => {
      const g = getGuideById('cheque-bounce');
      expect(g).toBeDefined();
      expect(g?.title_en).toContain('Cheque Bounce');
    });
  });

  describe('Text Normalisation', () => {
    it('normalises English case and punctuation', () => {
      expect(normaliseText('Hello, World! This is a test...')).toBe('hello world this is a test');
    });

    it('normalises Devanagari text, dandas and quotes', () => {
      expect(normaliseText('नमस्ते। यह एक परीक्षण है॥ “चेक बाउंस”?')).toBe('नमस्ते यह एक परीक्षण है चेक बाउंस');
    });

    it('tokenises normalised text into words', () => {
      expect(tokenise('Road accident on NH-53 near Raipur.')).toEqual([
        'road',
        'accident',
        'on',
        'nh',
        '53',
        'near',
        'raipur',
      ]);
    });
  });

  describe('Matcher Behavior & Edge Cases', () => {
    it('returns empty array for empty or whitespace query', () => {
      expect(matchGuides('')).toEqual([]);
      expect(matchGuides('   ')).toEqual([]);
      expect(matchGuides('.,! -')).toEqual([]);
    });

    it('returns top 3 results by default with matchedWords and positive scores', () => {
      const matches = matchGuides('A speeding truck hit my motorcycle on the highway and the driver ran away');
      expect(matches.length).toBeLessThanOrEqual(3);
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].guide.id).toBe('road-accident');
      expect(matches[0].score).toBeGreaterThan(0);
      expect(matches[0].matchedWords.length).toBeGreaterThan(0);
    });

    it('returns matchedWords for matched topics', () => {
      const matches = matchGuides('I want to file a consumer complaint for defective laptop on e-Daakhil');
      const top = matches[0];
      expect(top.guide.id).toBe('consumer-complaint');
      expect(top.matchedWords).toContain('consumer complaint');
      expect(top.matchedWords).toContain('e-Daakhil');
    });
  });

  describe('20 Realistic Citizen Descriptions (English and Hindi)', () => {
    // 10 English Realistic Citizen Queries
    const englishTestCases = [
      {
        scenario: '1. Road Accident / Hit and Run',
        query: 'A speeding car hit my father while crossing the road. The driver fled the scene and father suffered fracture. How do we claim MACT compensation in hit and run?',
        expectedPrimaryId: 'road-accident',
      },
      {
        scenario: '2. Police Station Refuses FIR',
        query: 'I went to the police station because my shop was looted, but the SHO refused to register my FIR and tore my complaint. How to approach SP or magistrate?',
        expectedPrimaryId: 'police-refuses-fir',
      },
      {
        scenario: '3. Domestic Violence & Eviction',
        query: 'My husband has been beating me every day and his family threw me and my children out of our shared household. I need an urgent protection order and residence.',
        expectedPrimaryId: 'domestic-violence',
      },
      {
        scenario: '4. Dowry Harassment & Demands',
        query: 'My in-laws and husband are demanding a new car and 10 lakh cash dowry. They lock me in the room and abuse me continuously for dowry.',
        expectedPrimaryId: 'dowry-cruelty',
      },
      {
        scenario: '5. Cheque Bounce & Return Memo',
        query: 'A contractor gave me a cheque of 4 lakhs for construction work, but the bank returned it with memo saying funds insufficient. How to send legal notice under section 138?',
        expectedPrimaryId: 'cheque-bounce',
      },
      {
        scenario: '6. Consumer Dispute & Defective Product',
        query: 'I purchased a refrigerator online from an e-commerce website which arrived broken. The company refuses replacement or refund under warranty.',
        expectedPrimaryId: 'consumer-complaint',
      },
      {
        scenario: '7. Cybercrime & UPI Scam',
        query: 'Someone called pretending to be a bank manager, asked for OTP and 60,000 rupees got debited from my bank account via UPI phishing link. How to call 1930 and freeze money?',
        expectedPrimaryId: 'cybercrime-fraud',
      },
      {
        scenario: '8. Unpaid Wages & Salary Withheld',
        query: 'Our factory manager has not paid wages and salary to 20 labourers for the last 4 months. How to file a claim before the Labour Commissioner under Payment of Wages Act?',
        expectedPrimaryId: 'unpaid-wages',
      },
      {
        scenario: '9. Tenant Landlord Dispute & Disconnection of Electricity',
        query: 'My landlord disconnected my electricity and water supply without any notice and is threatening forcible eviction from the rented apartment.',
        expectedPrimaryId: 'tenant-landlord',
      },
      {
        scenario: '10. Land Boundary Dispute & Encroachment',
        query: 'A neighbouring farmer encroached on 2 acres of our ancestral land by breaking boundary stones. How do we get demarcation and file civil suit for injunction?',
        expectedPrimaryId: 'property-land-dispute',
      },
      {
        scenario: '11. Arrest Rights & Detention Safeguards',
        query: 'Police picked up my brother from home last night without an arrest memo and have not produced him before any magistrate even after 24 hours.',
        expectedPrimaryId: 'arrest-rights',
      },
      {
        scenario: '12. Free Legal Aid & NALSA Helpline',
        query: 'I am a poor widow and cannot afford an advocate for my court case. How do I get a free lawyer from DLSA and call NALSA 15100?',
        expectedPrimaryId: 'free-legal-aid',
      },
      {
        scenario: '13. Maintenance for Wife & Elderly Parents',
        query: 'My husband deserted me and our minor son and refuses to give any monthly maintenance for food, school fees and shelter.',
        expectedPrimaryId: 'maintenance',
      },
      {
        scenario: '14. Workplace Sexual Harassment & POSH Act',
        query: 'My senior manager at the office repeatedly makes sexually coloured remarks, touches me inappropriately and threatens to ruin my appraisal if I do not comply.',
        expectedPrimaryId: 'workplace-sexual-harassment',
      },
    ];

    for (const { scenario, query, expectedPrimaryId } of englishTestCases) {
      it(`correctly matches English scenario: ${scenario}`, () => {
        const matches = matchGuides(query);
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].guide.id).toBe(expectedPrimaryId);
        expect(matches[0].score).toBeGreaterThan(0);
        expect(matches[0].matchedWords.length).toBeGreaterThan(0);
      });
    }

    // 10+ Hindi Realistic Citizen Queries in Devanagari
    const hindiTestCases = [
      {
        scenario: '15. सड़क दुर्घटना और अज्ञात वाहन (Hit & Run)',
        query: 'सड़क पर एक तेज रफ्तार गाड़ी ने मेरे भाई की बाइक में टक्कर मार दी और ड्राइवर भाग गया। अस्पताल में इलाज चल रहा है, क्या हमें हिट एंड रन या एमएसीटी ट्रिब्यूनल से मुआवजा मिलेगा?',
        expectedPrimaryId: 'road-accident',
      },
      {
        scenario: '16. पुलिस द्वारा एफआईआर दर्ज न करना',
        query: 'थानेदार साहब ने मेरी चोरी की प्राथमिकी (एफआईआर) दर्ज करने से साफ मना कर दिया। अब क्या मैं एसपी को डाक से शिकायत भेज सकता हूँ या मजिस्ट्रेट के पास जाना होगा?',
        expectedPrimaryId: 'police-refuses-fir',
      },
      {
        scenario: '17. घरेलू हिंसा और ससुराल से बेदखली',
        query: 'पति शराब पीकर रोज मारपीट करता है और मुझे घर से बाहर निकाल दिया है। मुझे बच्चों के साथ रहने के लिए मकान और संरक्षण आदेश चाहिए।',
        expectedPrimaryId: 'domestic-violence',
      },
      {
        scenario: '18. दहेज की मांग और क्रूरता',
        query: 'ससुराल वाले शादी के बाद से ही बुलेट गाड़ी और 5 लाख रुपये दहेज मांग रहे हैं और मेरी बेटी को कमरे में बंद करके प्रताड़ित कर रहे हैं।',
        expectedPrimaryId: 'dowry-cruelty',
      },
      {
        scenario: '19. चेक बाउंस और 138 का कानूनी नोटिस',
        query: 'व्यापारी ने जो 2 लाख का चेक दिया था वह बैंक में बाउंस हो गया और बैंक ने इनसफिशिएंट फंड्स का रिटर्न मेमो दिया है। 15 दिन का विधिक नोटिस कैसे भेजें?',
        expectedPrimaryId: 'cheque-bounce',
      },
      {
        scenario: '20. खराब सामान और उपभोक्ता फोरम',
        query: 'दुकानदार ने खराब टीवी बेच दिया और गारंटी होने के बावजूद बदलने से मना कर रहा है। क्या मैं ई-दाखिल पोर्टल पर जिला उपभोक्ता आयोग में शिकायत कर सकता हूँ?',
        expectedPrimaryId: 'consumer-complaint',
      },
      {
        scenario: '21. साइबर ठगी और 1930 हेल्पलाइन',
        query: 'अज्ञात व्यक्ति ने फर्जी लिंक भेजकर मेरे बैंक खाते से 40000 रुपये काट लिए। मैंने तुरंत 1930 पर फोन किया है, आगे साइबर सेल में क्या करें?',
        expectedPrimaryId: 'cybercrime-fraud',
      },
      {
        scenario: '22. बकाया वेतन और मजदूरी न मिलना',
        query: 'ठेकेदार ने हम 15 मजदूरों का पिछले तीन महीने का वेतन और बकाया पगार नहीं दी है। लेबर कमिश्नर के पास वेतन भुगतान अधिनियम में कैसे अर्जी लगाएं?',
        expectedPrimaryId: 'unpaid-wages',
      },
      {
        scenario: '23. किरायेदार की बिजली-पानी काटना',
        query: 'मकान मालिक ने बिना किसी नोटिस के मेरे कमरे का पानी और बिजली काट दिया और जबरन ताला लगाने की धमकी दे रहा है।',
        expectedPrimaryId: 'tenant-landlord',
      },
      {
        scenario: '24. जमीन पर अवैध कब्जा और सीमांकन',
        query: 'दबंग पड़ोसी ने हमारी पुश्तैनी जमीन पर मेड़ तोड़कर अवैध कब्जा कर लिया है। तहसीलदार से सीमांकन कराकर सिविल कोर्ट से स्टे ऑर्डर कैसे लें?',
        expectedPrimaryId: 'property-land-dispute',
      },
      {
        scenario: '25. अवैध गिरफ्तारी और पुलिस हिरासत',
        query: 'पुलिस मेरे बेटे को बिना कोई कारण बताए या अरेस्ट मेमो दिए पकड़कर ले गई और 24 घंटे बीत जाने पर भी कोर्ट में पेश नहीं किया।',
        expectedPrimaryId: 'arrest-rights',
      },
      {
        scenario: '26. मुफ्त कानूनी सहायता और डीएलएसए',
        query: 'हम गरीब हैं और कोर्ट केस लड़ने के लिए वकील की फीस नहीं दे सकते। जिला विधिक सेवा प्राधिकरण (DLSA) से मुफ्त सरकारी वकील कैसे मिलेगा?',
        expectedPrimaryId: 'free-legal-aid',
      },
      {
        scenario: '27. बुजुर्ग माता-पिता का भरण-पोषण',
        query: 'बेटों ने हमारी पूरी जमीन अपने नाम करा ली और अब मुझे और मेरी पत्नी को खाना और दवा नहीं दे रहे। वरिष्ठ नागरिक कानून 2007 में गुजारा भत्ता कैसे पाएं?',
        expectedPrimaryId: 'maintenance',
      },
      {
        scenario: '28. ऑफिस में यौन उत्पीड़न और पॉश कानून',
        query: 'दफ्तर में सुपरवाइजर लगातार अवांछित शारीरिक स्पर्श और अश्लील बातें करता है। कंपनी की आंतरिक शिकायत समिति (आईसीसी) या शी-बॉक्स में कैसे शिकायत करें?',
        expectedPrimaryId: 'workplace-sexual-harassment',
      },
    ];

    for (const { scenario, query, expectedPrimaryId } of hindiTestCases) {
      it(`correctly matches Hindi scenario: ${scenario}`, () => {
        const matches = matchGuides(query);
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].guide.id).toBe(expectedPrimaryId);
        expect(matches[0].score).toBeGreaterThan(0);
        expect(matches[0].matchedWords.length).toBeGreaterThan(0);
      });
    }
  });
});

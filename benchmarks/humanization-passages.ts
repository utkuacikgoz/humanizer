import type { HumanizationBenchmarkPassage } from "../src/lib/humanization/benchmark";
import type { WritingMode } from "../src/lib/humanization/types";

type Seed = [text: string, expectedProtectedFacts?: HumanizationBenchmarkPassage["expectedProtectedFacts"]];

function passages(category: string, mode: WritingMode, seeds: Seed[]): HumanizationBenchmarkPassage[] {
  if (seeds.length !== 10) throw new Error(`${category} must contain exactly 10 benchmark passages.`);
  const prefix = category.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return seeds.map(([text, expectedProtectedFacts = []], index) => ({
    id: `${prefix}-${String(index + 1).padStart(2, "0")}`,
    category,
    text,
    mode,
    expectedProtectedFacts,
  }));
}

const obviousChatGpt = passages("obvious ChatGPT prose", "natural", [
  ["In today's fast-paced world, effective communication stands as a testament to human ingenuity. Furthermore, it is important to note that clear messages can make a lasting impact."],
  ["The realm of remote work is a multifaceted landscape. Moreover, organizations can leverage robust solutions to drive value at scale."],
  ["It is worth mentioning that reading is not merely a hobby; it is a gateway to endless possibilities. In conclusion, the possibilities are endless."],
  ["Delving into the ever-evolving tapestry of urban life reveals many pivotal challenges. Additionally, thoughtful planning is crucial to note for a brighter future."],
  ["In today's fast-paced world, coffee plays an important role in daily routines. It not only creates energy but also fosters meaningful connections."],
  ["The fact of the matter is that teamwork can unlock synergy. Moving forward, teams should utilize best-in-class methods to achieve strategic alignment."],
  ["Furthermore, exercise offers a multitude of benefits. It is important to note that consistency is the key that unlocks long-term success."],
  ["This article will delve into the multifaceted realm of gardening. Moreover, it will underscore the pivotal role that patience plays."],
  ["As we have seen, technology continues to shape our lives in profound ways. In conclusion, only time will tell what the future holds."],
  ["Needless to say, education stands as a testament to society's commitment to progress. Additionally, it empowers people to make a lasting impact."],
]);

const academic = passages("academic", "academic", [
  ["It is important to note that the experiment included 84 participants. Moreover, the observed association does not establish causality.", [{ kind: "number", value: "84" }]],
  ["The study examined soil respiration across three forest plots in May 14, 2024. Additionally, measurements were collected at dawn and dusk.", [{ kind: "date", value: "May 14, 2024" }]],
  ["Our analysis utilizes a Bayesian model in order to estimate uncertainty. The posterior distribution is subsequently compared with the baseline."],
  ["The findings underscore a multifaceted relationship between sleep and recall. Nevertheless, the small sample limits generalization."],
  ["In conclusion, the archive reveals that local officials negotiated rather than merely resisted. This interpretation remains contingent on incomplete records."],
  ["The survey was administered in 12 schools, and 73% of respondents completed every item. It should be noted that participation was voluntary.", [{ kind: "number", value: "12" }, { kind: "percentage", value: "73%" }]],
  ["This paper delves into the role of informal credit networks. Furthermore, it situates household decisions within an ever-evolving policy landscape."],
  ["The model achieved an F1 score of 0.81 on the held-out set. However, performance declined when labels were imbalanced.", [{ kind: "number", value: "0.81" }]],
  ["The interviews indicate that workers valued autonomy more than schedule flexibility. Moreover, this pattern appeared in each occupational group."],
  ["These results provide robust evidence for a seasonal effect. In summary, temperature remains a pivotal predictor of migration timing."],
]);

const professional = passages("professional", "professional", [
  ["Moving forward, the operations team will leverage our existing workflow to drive value. The first review is scheduled for June 18, 2026.", [{ kind: "date", value: "June 18, 2026" }]],
  ["It is important to note that the client approved the revised scope. Additionally, delivery remains on track for Q4."],
  ["We need strategic alignment before we commence implementation. Please share final comments with Dr. Maya Chen by August 12, 2026.", [{ kind: "person", value: "Dr. Maya Chen" }, { kind: "date", value: "August 12, 2026" }]],
  ["The support queue declined from 46 tickets to 19 tickets this week. Moreover, the median response time is now 3.2 hours.", [{ kind: "number", value: "46" }, { kind: "number", value: "19" }, { kind: "number", value: "3.2" }]],
  ["Our robust solution will enable cross-functional teams to operate at scale. In order to proceed, each manager must confirm ownership."],
  ["The fact of the matter is that the vendor missed two milestones. Moving forward, procurement will require weekly status notes."],
  ["Thank you for your patience while we investigated the issue. The service was fully restored at 14:20 UTC on 2026-08-03.", [{ kind: "date", value: "2026-08-03" }]],
  ["Furthermore, the finance group identified $18,400 in avoidable annual costs. We recommend ending the unused contracts in September.", [{ kind: "currency", value: "$18,400" }]],
  ["I wanted to reach out in order to provide an update regarding the hiring plan. We have filled 7 of the 10 approved roles.", [{ kind: "number", value: "7" }, { kind: "number", value: "10" }]],
  ["In conclusion, the pilot delivered meaningful value-added outcomes. The leadership team will decide whether to expand it next Monday."],
]);

const marketing = passages("marketing", "natural", [
  ["Meet Atlas 2.4, the robust solution that transforms the way teams collaborate. Unlock your potential and make a lasting impact today.", [{ kind: "product", value: "Atlas 2.4" }]],
  ["In today's fast-paced world, your inbox should work smarter, not harder. FlowMail 3.1 helps you reclaim approximately 5 hours every week.", [{ kind: "product", value: "FlowMail 3.1" }, { kind: "number", value: "5" }]],
  ["Our best-in-class bottle keeps drinks cold for 24 hours. Furthermore, every purchase supports a brighter future.", [{ kind: "number", value: "24" }]],
  ["The possibilities are endless with Studio Kit 1.8. Create, share, and inspire without disrupting your creative flow.", [{ kind: "product", value: "Studio Kit 1.8" }]],
  ["Save 30% on your first order before September 5, 2026. Additionally, members receive complimentary delivery.", [{ kind: "percentage", value: "30%" }, { kind: "date", value: "September 5, 2026" }]],
  ["Designed for the ever-evolving modern traveler, the CarryOne bag combines form and function. It weighs just 1.2 kilograms.", [{ kind: "number", value: "1.2" }]],
  ["Join more than 12,000 creators who leverage BrightDesk to drive value at scale. Start your journey today.", [{ kind: "number", value: "12,000" }]],
  ["It is important to note that good skincare begins with consistency. Our serum contains 2% niacinamide and no added fragrance.", [{ kind: "percentage", value: "2%" }]],
  ["Transform your mornings with coffee roasted on August 1, 2026. Moreover, each bag can be traced to a single cooperative.", [{ kind: "date", value: "August 1, 2026" }]],
  ["The ultimate productivity companion has arrived. For $6.99 per month, Planly makes every day seamless and effortless.", [{ kind: "currency", value: "$6.99" }]],
]);

const casual = passages("casual", "casual", [
  ["I went to the new place on Friday and, honestly, it was really quite good. Additionally, the noodles were approximately twice as spicy as I expected."],
  ["We kinda got the ball rolling around 8 p.m. Then everyone just hung out in the kitchen for most of the night.", [{ kind: "number", value: "8" }]],
  ["It is worth mentioning that my dog absolutely refused to walk in the rain. So we watched three episodes on the couch instead."],
  ["The trip was awesome, but the train was very late. We eventually reached Da Nang on July 9, 2026.", [{ kind: "date", value: "July 9, 2026" }]],
  ["I tried that bread recipe again. The end result was better, although I still put in way too much salt."],
  ["Moreover, the beach was almost empty. We paid $4 for two chairs and stayed until sunset.", [{ kind: "currency", value: "$4" }]],
  ["My phone died halfway there, which was kind of annoying. Thankfully, Priya Shah said she remembered the address.", [{ kind: "person", value: "Priya Shah" }]],
  ["Needless to say, I did not finish the book. The first chapter was 68 pages and I kept falling asleep.", [{ kind: "number", value: "68" }]],
  ["We made future plans to meet again next month. I really hope we pick somewhere quieter."],
  ["In conclusion, the concert was a good time. The encore started at 10:45 and lasted about 20 minutes.", [{ kind: "number", value: "10" }, { kind: "number", value: "45" }, { kind: "number", value: "20" }]],
]);

const technical = passages("technical", "professional", [
  ["The API returns HTTP 429 when a client exceeds 120 requests per minute. Additionally, the response includes a `Retry-After` header.", [{ kind: "technical-term", value: "API" }, { kind: "technical-term", value: "HTTP" }, { kind: "number", value: "429" }, { kind: "number", value: "120" }, { kind: "code", value: "`Retry-After`" }]],
  ["Deploy Service Core 2.7 with Docker, then run `npm run migrate`. It is important to note that the command must finish before traffic shifts.", [{ kind: "product", value: "Service Core 2.7" }, { kind: "technical-term", value: "Docker" }, { kind: "code", value: "`npm run migrate`" }]],
  ["The PostgreSQL query scans 1.8 million rows because the index excludes `account_id`. Moreover, the SQL planner estimates the filter incorrectly.", [{ kind: "technical-term", value: "PostgreSQL" }, { kind: "code", value: "`account_id`" }, { kind: "technical-term", value: "SQL" }, { kind: "number", value: "1.8" }]],
  ["TLS 1.3 is required for connections to https://api.example.com/v2. Older clients receive an HTTP 426 response.", [{ kind: "technical-term", value: "TLS" }, { kind: "number", value: "1.3" }, { kind: "url", value: "https://api.example.com/v2" }, { kind: "technical-term", value: "HTTP" }, { kind: "number", value: "426" }]],
  ["The React component stores a stale value because the effect omits `userId`. In order to fix it, include the value in the dependency array.", [{ kind: "technical-term", value: "React" }, { kind: "code", value: "`userId`" }]],
  ["The Python worker uses 640 MB of RAM while processing 25 files. Furthermore, each retry creates another temporary buffer.", [{ kind: "technical-term", value: "Python" }, { kind: "number", value: "640" }, { kind: "technical-term", value: "RAM" }, { kind: "number", value: "25" }]],
  ["OAuth tokens expire after 3,600 seconds. The SDK refreshes them when fewer than 300 seconds remain.", [{ kind: "technical-term", value: "OAuth" }, { kind: "number", value: "3,600" }, { kind: "technical-term", value: "SDK" }, { kind: "number", value: "300" }]],
  ["Kubernetes restarted the pod 6 times after the health check began returning HTTP 503. Moving forward, the timeout will increase to 8 seconds.", [{ kind: "technical-term", value: "Kubernetes" }, { kind: "number", value: "6" }, { kind: "technical-term", value: "HTTP" }, { kind: "number", value: "503" }, { kind: "number", value: "8" }]],
  ["The TypeScript build fails on `Result<string>` because the generic is invariant. It should be noted that JavaScript consumers are unaffected.", [{ kind: "technical-term", value: "TypeScript" }, { kind: "code", value: "`Result<string>`" }, { kind: "technical-term", value: "JavaScript" }]],
  ["A GPU processes the batch in 42 ms, while the CPU path takes 310 ms. In conclusion, batching is pivotal for throughput.", [{ kind: "technical-term", value: "GPU" }, { kind: "number", value: "42" }, { kind: "technical-term", value: "CPU" }, { kind: "number", value: "310" }]],
]);

const nonNative = passages("non-native English", "natural", [
  ["Yesterday I go to the bank because my card was not working. The employee explain the problem very clearly and now it works."],
  ["Our team have finished the report on Monday. Additionally, we are waiting the manager to give final feedback."],
  ["I am living in this neighborhood since three years. It is very convenient because many shop are near my apartment."],
  ["The meeting was postponed to August 20, 2026 because several people could not to attend. Please confirm if the new date is suitable.", [{ kind: "date", value: "August 20, 2026" }]],
  ["We discussed about the budget and decided to reduce it by 15%. This change will not affect the two current projects.", [{ kind: "percentage", value: "15%" }]],
  ["My colleague gave me many useful advices for the presentation. I practiced it two time before the client arrived."],
  ["The software is easy for use, but sometimes it close without warning. This happened 4 times during last week.", [{ kind: "number", value: "4" }]],
  ["I did not knew that the museum closes early on Sunday. Therefore, we only had 35 minutes to see the exhibition.", [{ kind: "number", value: "35" }]],
  ["The package arrived in good condition, however one cable was missing. Amazon said it will send replacement tomorrow.", [{ kind: "company", value: "Amazon" }]],
  ["She suggested me to apply for the role at Northwind Ltd. Moreover, the salary is €48,000 per year.", [{ kind: "company", value: "Northwind Ltd" }, { kind: "currency", value: "€48,000" }]],
]);

const citationHeavy = passages("citation-heavy", "academic", [
  ["Urban shade can lower surface temperatures by several degrees (Akbari, 2023). However, benefits vary with canopy density (Li et al., 2024).", [{ kind: "citation", value: "(Akbari, 2023)" }, { kind: "citation", value: "(Li et al., 2024)" }]],
  ["The intervention improved attendance [12], but it did not change test scores [14–16]. Furthermore, the follow-up was limited to one term.", [{ kind: "citation", value: "[12]" }, { kind: "citation", value: "[14–16]" }]],
  ["Prior work treats trust as relational rather than fixed (Mayer, 1995). This view was later extended to online groups (Chen & Rao, 2022).", [{ kind: "citation", value: "(Mayer, 1995)" }, { kind: "citation", value: "(Chen & Rao, 2022)" }]],
  ["The dataset is archived under doi:10.5281/zenodo.7654321. It is important to note that the license permits reuse with attribution.", [{ kind: "reference", value: "doi:10.5281/zenodo.7654321" }]],
  ["Heat exposure is associated with lower output (Park, 2021, p. 44). Moreover, adaptation appears uneven across occupations [7].", [{ kind: "citation", value: "(Park, 2021, p. 44)" }, { kind: "citation", value: "[7]" }]],
  ["Several reviews report publication bias (Singh et al., 2020; this concern remains unresolved). The registered protocol is doi:10.1000/xyz123.", [{ kind: "reference", value: "doi:10.1000/xyz123" }]],
  ["The method follows the original calibration procedure [2, 5]. In addition, we report deviations requested by reviewers (Olsen, 2024).", [{ kind: "citation", value: "[2, 5]" }, { kind: "citation", value: "(Olsen, 2024)" }]],
  ["Early accounts emphasized formal institutions (North, 1990). Newer studies foreground informal enforcement (Adebayo et al., 2025).", [{ kind: "citation", value: "(North, 1990)" }, { kind: "citation", value: "(Adebayo et al., 2025)" }]],
  ["The effect disappears after household fixed effects are added [31]. Nevertheless, the descriptive pattern matches earlier evidence (Wu, 2019).", [{ kind: "citation", value: "[31]" }, { kind: "citation", value: "(Wu, 2019)" }]],
  ["Replication materials are available at https://osf.io/ab12c/. In conclusion, transparent reporting remains pivotal (Diaz, 2026).", [{ kind: "url", value: "https://osf.io/ab12c/" }, { kind: "citation", value: "(Diaz, 2026)" }]],
]);

const numberHeavy = passages("number-heavy", "professional", [
  ["Revenue rose 18.4% from $2.6 million to $3.08 million in Q2. Operating costs increased by 7.1% during the same period.", [{ kind: "percentage", value: "18.4%" }, { kind: "currency", value: "$2.6 million" }, { kind: "currency", value: "$3.08 million" }, { kind: "percentage", value: "7.1%" }]],
  ["The trial enrolled 1,240 adults across 16 clinics. Of those participants, 62% received the intervention and 38% received usual care.", [{ kind: "number", value: "1,240" }, { kind: "number", value: "16" }, { kind: "percentage", value: "62%" }, { kind: "percentage", value: "38%" }]],
  ["At 09:30, the sensor read 21.7°C; by 14:00, it reached 29.3°C. Humidity fell from 74% to 51%.", [{ kind: "number", value: "21.7" }, { kind: "number", value: "29.3" }, { kind: "percentage", value: "74%" }, { kind: "percentage", value: "51%" }]],
  ["The warehouse shipped 8,920 orders on August 4, 2026. Exactly 117 orders, or 1.31%, were returned.", [{ kind: "number", value: "8,920" }, { kind: "date", value: "August 4, 2026" }, { kind: "number", value: "117" }, { kind: "percentage", value: "1.31%" }]],
  ["Plan A costs €24,500 up front and €1,200 per month. Plan B costs €9,000 up front and €2,050 per month.", [{ kind: "currency", value: "€24,500" }, { kind: "currency", value: "€1,200" }, { kind: "currency", value: "€9,000" }, { kind: "currency", value: "€2,050" }]],
  ["The battery retained 91% capacity after 500 cycles and 84% after 900 cycles. Each cycle ran at 25°C.", [{ kind: "percentage", value: "91%" }, { kind: "number", value: "500" }, { kind: "percentage", value: "84%" }, { kind: "number", value: "900" }, { kind: "number", value: "25" }]],
  ["Page load time declined from 2.8 seconds to 1.6 seconds, a 42.9% improvement. Error volume fell from 3,410 to 880 per day.", [{ kind: "number", value: "2.8" }, { kind: "number", value: "1.6" }, { kind: "percentage", value: "42.9%" }, { kind: "number", value: "3,410" }, { kind: "number", value: "880" }]],
  ["The route covers 684 km with 4 scheduled stops. Fuel consumption averages 31.2 liters per 100 km.", [{ kind: "number", value: "684" }, { kind: "number", value: "4" }, { kind: "number", value: "31.2" }, { kind: "number", value: "100" }]],
  ["On 2026-07-31, the fund held 43.6% equities, 36.4% bonds, and 20% cash. Total assets were $81.7 million.", [{ kind: "date", value: "2026-07-31" }, { kind: "percentage", value: "43.6%" }, { kind: "percentage", value: "36.4%" }, { kind: "percentage", value: "20%" }, { kind: "currency", value: "$81.7 million" }]],
  ["The recipe uses 320 g flour, 210 ml water, 7 g yeast, and 9 g salt. Bake it at 230°C for 28 minutes.", [{ kind: "number", value: "320" }, { kind: "number", value: "210" }, { kind: "number", value: "7" }, { kind: "number", value: "9" }, { kind: "number", value: "230" }, { kind: "number", value: "28" }]],
]);

const longForm = passages("long-form", "natural", [
  ["When the library reopened, residents returned slowly. The reading room still smelled of fresh paint, and several shelves had not been labeled. Furthermore, volunteers spent each morning helping visitors locate books. By June 2026, daily attendance had reached 340, nearly twice the winter average. The change mattered less as a statistic than as evidence that the building belonged to the neighborhood again.", [{ kind: "number", value: "340" }]],
  ["The first workshop was quiet. Participants watched the instructor shape the clay, but few were willing to touch their own blocks. It is important to note that confidence arrived gradually. By the third session, people were trading tools and laughing about collapsed bowls. One participant, Dr. Elena Ruiz, later organized a small exhibition on August 8, 2026.", [{ kind: "person", value: "Dr. Elena Ruiz" }, { kind: "date", value: "August 8, 2026" }]],
  ["Our team began the migration with a simple inventory. We found 67 active dashboards, 14 abandoned reports, and three jobs with no clear owner. Moreover, the old system had not been documented since 2021. We moved the critical jobs first and asked each department to validate its totals. The final cutover on 2026-05-17 produced no customer-facing outage.", [{ kind: "number", value: "67" }, { kind: "number", value: "14" }, { kind: "date", value: "2026-05-17" }]],
  ["Mina had passed the bakery for years without stepping inside. One wet afternoon, she noticed a handwritten sign offering lessons for $12. The class was clumsy and warm: flour covered the tables, and nobody shaped a perfect loaf. Additionally, the baker sent everyone home with a jar of starter. Mina returned the next week because the room felt welcoming, not because her bread was good.", [{ kind: "currency", value: "$12" }]],
  ["The river path looks effortless on a map, but its history is complicated. Engineers first proposed a paved route in 1998. Residents objected to the loss of trees, while accessibility groups argued that the existing trail excluded many users. Furthermore, the city held 11 public meetings before approving a narrower design. The path opened in September 2025 with 92% of the mature canopy intact.", [{ kind: "number", value: "1998" }, { kind: "number", value: "11" }, { kind: "percentage", value: "92%" }]],
  ["At first, the restaurant tracked waste only by cost. That approach hid which ingredients were being discarded and why. The kitchen then weighed every bin for 30 days and found that prep scraps accounted for 58% of the total. Moreover, chefs adjusted portion sizes and began using stems in the lunch stock. Monthly waste fell from 840 kg to 510 kg without shrinking the menu.", [{ kind: "number", value: "30" }, { kind: "percentage", value: "58%" }, { kind: "number", value: "840" }, { kind: "number", value: "510" }]],
  ["The software pilot started with two customer-service teams. Agents could accept the suggested reply, edit it, or discard it, and every choice was recorded. It is worth mentioning that managers did not use acceptance rate as a performance metric. After 6 weeks, response time was 13% lower, while satisfaction remained unchanged. The company extended the pilot only after workers reviewed the results.", [{ kind: "number", value: "6" }, { kind: "percentage", value: "13%" }]],
  ["On July 2, 2026, a storm cut power to the island clinic. The backup generator started correctly, but its fuel gauge was broken. Nurses estimated that they had 9 hours before refrigeration failed. Additionally, a fishing cooperative delivered two sealed drums from the mainland. Power returned that evening, and no vaccines were lost.", [{ kind: "date", value: "July 2, 2026" }, { kind: "number", value: "9" }]],
  ["The museum acquired the letters from a private collector for £46,000. At first glance, the 83 pages seemed to document an ordinary business dispute. A conservator noticed that several passages had been written in lemon juice and later heated. Moreover, the hidden notes described supply routes used during the 1912 strike. The museum will display both the letters and the imaging process rather than presenting the discovery as a finished story.", [{ kind: "currency", value: "£46,000" }, { kind: "number", value: "83" }, { kind: "number", value: "1912" }]],
  ["A neighborhood survey found that residents liked the market but disliked its traffic. Of 560 respondents, 71% wanted the market to remain weekly, while 64% supported closing one street on Saturdays. In conclusion, the council approved a 4-month trial with movable barriers and a bus detour. Staff will publish collision, footfall, and sales data at https://city.example.org/market-trial before any permanent vote.", [{ kind: "number", value: "560" }, { kind: "percentage", value: "71%" }, { kind: "percentage", value: "64%" }, { kind: "number", value: "4" }, { kind: "url", value: "https://city.example.org/market-trial" }]],
]);

export const HUMANIZATION_BENCHMARK_PASSAGES: HumanizationBenchmarkPassage[] = [
  ...obviousChatGpt,
  ...academic,
  ...professional,
  ...marketing,
  ...casual,
  ...technical,
  ...nonNative,
  ...citationHeavy,
  ...numberHeavy,
  ...longForm,
];

if (HUMANIZATION_BENCHMARK_PASSAGES.length !== 100) {
  throw new Error(`Humanization benchmark must contain exactly 100 passages; found ${HUMANIZATION_BENCHMARK_PASSAGES.length}.`);
}

import { runEvaluation } from "../lib/security/evaluation";

const report = runEvaluation();

console.log(JSON.stringify({
  summary: {
    totalCases: report.total,
    attacks: report.attacks,
    blockedAttacks: report.blockedAttacks,
    bypasses: report.bypasses,
    defenseRatePercent: Math.round(report.defenseRate * 1000) / 10,
    legitimateCases: report.legitimate,
    falsePositives: report.falsePositives,
    falsePositiveRatePercent: Math.round(report.falsePositiveRate * 1000) / 10,
  },
  failures: report.results.filter((result) => (result.malicious && !result.blocked) || (!result.malicious && result.blocked)),
}, null, 2));

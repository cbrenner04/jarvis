// All previously sandbox-unrunnable tests in this file were converted to mocked
// subprocess tests in pr.test.ts. The mockable cases use injected seams (branchName,
// checkPrExists, checkBaseCurrent, markReady, ghPrReady, runFix, runReady,
// commitPreReadyFix, fetchPrBody, writePrBody, renderFooter, getDiffStats,
// getCommitSubjects, agent) and the SubprocessRunner boundary instead of real git/gh.
// No tests remain that require real subprocess.

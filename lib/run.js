const core = require('@actions/core');
const github = require('@actions/github');

const request = require('./request');
const cljKondo = require('./clj_kondo');

const { GITHUB_SHA, GITHUB_EVENT_PATH, GITHUB_WORKSPACE, GITHUB_REPOSITORY } = process.env;

const checkName = core.getInput('check-name');
const githubToken = core.getInput('github-token');

const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github.antiope-preview+json',
    Authorization: `Bearer ${githubToken}`,
    'User-Agent': 'clojure-lint-action'
};

async function createCheck() {
    const body = {
        name: checkName,
        head_sha: GITHUB_SHA,
        status: 'in_progress',
        started_at: new Date()
    };

    const { data } = await request(`https://api.github.com/repos/${GITHUB_REPOSITORY}/check-runs`, {
        method: 'POST',
        headers,
        body
    });
    const { id } = data;
    return id;
}

async function updateCheck(id, conclusion, output) {
    const body = {
        name: checkName,
        head_sha: GITHUB_SHA,
        status: conclusion === 'in-progress' ? 'in_progress' : 'completed',
    };

    if (conclusion !== 'in-progress') {
        body.completed_at = new Date();
        body.conclusion = conclusion;
    }

    if (output) {
        body.output = output;
    }

    await request(`https://api.github.com/repos/${GITHUB_REPOSITORY}/check-runs/${id}`, {
        method: 'PATCH',
        headers,
        body
    });
}

function exitWithError(err) {
    console.error('Error', err.stack);
    if (err.data) {
        console.error(err.data);
    }
    process.exit(1);
}

function chunk(array, size) {
    if (!array) return [];
    const firstChunk = array.slice(0, size);
    if (!firstChunk.length) {
        return array;
    }
    return [firstChunk].concat(chunk(array.slice(size, array.length), size));
}

const annotationLevels = {
    info: "notice",
    warning: "warning",
    error: "failure"
};

function summaryText(summary) {
    return `linting took ${summary.duration}ms, errors: ${summary.error}, warnings: ${summary.warning}, info: ${summary.info}`;
}

function summaryConclusion(summary) {
    if (summary.error > 0) return 'failure';
    if (summary.warning > 0 || summary.info > 0) return 'neutral';
    return 'success';
}

async function postResults(checkId, parsedOut) {
    let { findings, summary } = parsedOut;
    let checkSummary = summaryText(summary);
    for (const c of chunk(findings, 50)) {
        let annotations = [];
        for (const f of c) {
            const { filename, level, type, col, row, message } = f;
            annotations.push({
                path: filename,
                start_line: row,
                end_line: row,
                annotation_level: annotationLevels[level],
                message: `[${type}] ${message}`
            });
        }
        await updateCheck(checkId, 'in-progress', {
            title: checkName,
            summary: checkSummary,
            annotations
        });
    }

    let conclusion = summaryConclusion(summary);

    if(conclusion !== 'success'){
        console.log(`clj-kondo detected some problems. Please check found problems at https://github.com/${GITHUB_REPOSITORY}/runs/${checkId}`);
    }
    await updateCheck(checkId, conclusion, {
        title: checkName,
        summary: checkSummary
    });
}

async function run() {
    const checkId = await createCheck();
    try {
        const cljKondoCmd = core.getInput('clj-kondo-cmd');
        let { exitCode, stdout, stderr, parsedOut } = await cljKondo(cljKondoCmd);

        if (parsedOut) {
            await postResults(checkId, parsedOut);
        } else {
            // Unable to parse clj-kondo output so just write it to console in the hope it's useful.
            console.log("Unable to parse clj-kondo json output.");
            console.log(stdout);
        }

        if (stderr) {
            let err = new Error("Failed to run clj-kondo");
            err.data = stderr;
            throw err;
        }
        process.exit(exitCode);
    } catch (err) {
        await updateCheck(checkId, 'failure');
        exitWithError(err);
    }
}

run().catch(exitWithError);

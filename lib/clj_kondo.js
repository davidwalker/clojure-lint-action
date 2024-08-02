const { spawn } = require( 'child_process' );
const spawnargs = require('./spawnargs');

async function cljKondo(cmdString) {
    let [cmd, ...args] = spawnargs(cmdString);
    return new Promise((resolve, reject) => {
        let result = {
            stdout: "",
            stderr: "",
            exitCode: null,
            parsedOut: null
        };
        const kondo = spawn(cmd,
                            args,
                            {
                                shell: true
                            });
        kondo.stdout.on('data', data => {
            result.stdout += data.toString();
        });
        kondo.stderr.on('data', data => {
            result.stderr += data.toString();
        });
        kondo.on('close', code => {
            result.exitCode = code;
            try {
                result.parsedOut = JSON.parse(result.stdout);
            }
            catch {}
            resolve(result);
        });
    });
}

module.exports = cljKondo;

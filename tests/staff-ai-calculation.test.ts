import test from 'node:test';
import assert from 'node:assert/strict';
import { runBashCalculation, parseBashCalculation } from '../src/core/ai/BashCalculation.ts';
import { bashCalculationHandler } from '../src/commands/staff/subcommands/ai-tools/calculate.ts';
import { executeStaffScheduledTask } from '../src/core/ai/StaffAIScheduledTask.ts';

const bc = (program: string) => `bc -l <<'BC'\n${program}\nBC`;

test('Bash integer arithmetic and bc decimal/scientific computations produce real results', async () => {
    assert.equal((await runBashCalculation('echo "$((2**20 + 15%4))"') as any).stdout, '1048579');
    const decimal: any = await runBashCalculation("printf '%s\\n' 'scale=50; sqrt(2)' | bc -l");
    assert.equal(decimal.stdout, '1.41421356237309504880168872420969807856967187537694');
    assert.equal((await runBashCalculation("echo 'scale=8; 1/8' | bc -l") as any).stdout, '.12500000');
    const scientific: any = await runBashCalculation(bc('scale=60; 4*a(1)\nl(e(1))'));
    assert.match(scientific.stdout, /^3\.141592653589793238462643383279502884197/);
    assert.match(scientific.stdout, /\n\.(?:9{30,})/);
});

test('bc functions, loops, large integers and arrays support advanced calculations', async () => {
    const result: any = await runBashCalculation(bc('define f(n) { auto r,i; r=1; for(i=2;i<=n;i++) r*=i; return(r); }\nf(100)'));
    let factorial = 1n;
    for (let i = 1n; i <= 100n; i++) factorial *= i;
    assert.equal(result.stdout, factorial.toString());
    const mean: any = await runBashCalculation(bc('scale=6; x[0]=2; x[1]=4; x[2]=9; t=0; for(i=0;i<3;i++) t+=x[i]; t/3'));
    assert.equal(mean.stdout, '5.000000');
});

test('General shell commands, substitution, file access and additional commands are rejected', async () => {
    for (const command of ['cat /etc/passwd', 'curl https://example.com', 'python3 -c "print(2)"',
        'echo "$((2))"; id', 'echo "$(( $(id) + 1 ))"', 'echo "$((a[1]))"',
        'echo "$((RANDOM+1))"', 'echo "$((1)) 2+3))"', 'echo "$((1))" > result.txt',
        "echo '2' | bc -l; pwd", "bc -l <<BC\n2+2\nBC", bc('2+2') + '\nid',
        'x'.repeat(16_001), 'echo "$((2))"\0']) {
        assert.equal(parseBashCalculation(command), null, command.slice(0, 100));
        assert.ok((await runBashCalculation(command) as any).error);
    }
    const literal: any = await runBashCalculation(bc('"$(id)"'));
    assert.equal(literal.stdout, '$(id)'); // Quoted bc data is never interpreted by Bash.
});

test('Syntax, zero division and invalid tool arguments produce structured errors', async () => {
    for (const command of [bc('1/0'), bc('2+'), 'echo "$((1/0))"']) {
        const result: any = await runBashCalculation(command);
        assert.ok(result.error, command);
        assert.equal(result.success, undefined);
        assert.ok(result.stderr);
    }
    assert.ok((await bashCalculationHandler({command: 2}) as any).error);
    assert.ok((await bashCalculationHandler(null) as any).error);
});

test('Excess output and infinite computation are terminated within resource limits', async () => {
    const output: any = await runBashCalculation(bc('for(i=0;i<100000;i++) print "1234567890123456789012345678901234567890"'));
    assert.match(output.error, /出力量/);
    const started = Date.now();
    const infinite: any = await runBashCalculation(bc('while(1) { a=1; }'));
    assert.ok(infinite.error);
    assert.ok(Date.now() - started < 8_000);
});

test('Scheduled calculations use the calculation tool instead of Web research', async () => {
    const tools = new Map<string, any>();
    const result = await executeStaffScheduledTask({id: 'calc', mode: 'task', task: '平方根2を小数50桁で計算して',
        guildId: 'guild', userId: 'user', channelId: 'channel', message: '計算', runAt: new Date().toISOString(),
        createdAt: new Date().toISOString(), status: 'pending', attempts: 0}, Date.now(), {
        registerTool: (definition, handler) => { tools.set(definition.function.name, handler); },
        generateText: async (_messages, options) => {
            assert.deepEqual(options?.forceToolSequence, ['calculate_bash']);
            const output = await tools.get('calculate_bash')({command: bc('scale=50; sqrt(2)')});
            return output.stdout;
        },
    });
    assert.match(result, /^1\.4142135623730950488/);
});

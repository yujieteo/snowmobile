#!/usr/bin/env node
// snowmobile: hunt real software for parts, recombine them, then grill the result as a tree.
// One local process: an HTTP server on 127.0.0.1, one SQLite file, and the `claude` CLI.

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

// ---------- database ----------

function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS hunts (
      id INTEGER PRIMARY KEY, seed TEXT NOT NULL, status TEXT NOT NULL, error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY, hunt_id INTEGER NOT NULL, name TEXT, kind TEXT, url TEXT, summary TEXT);
    CREATE TABLE IF NOT EXISTS components (
      id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL, name TEXT, mechanism TEXT, url TEXT,
      bad_reason TEXT);
    CREATE TABLE IF NOT EXISTS snowmobiles (
      id INTEGER PRIMARY KEY, hunt_id INTEGER NOT NULL, name TEXT, pitch TEXT, component_ids TEXT,
      status TEXT NOT NULL, proof_url TEXT, proof_note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS grills (
      id INTEGER PRIMARY KEY, snowmobile_id INTEGER NOT NULL UNIQUE, tree TEXT NOT NULL,
      status TEXT NOT NULL, brief TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS paradigms (
      id INTEGER PRIMARY KEY, layer TEXT NOT NULL, name TEXT NOT NULL, summary TEXT, url TEXT);
    CREATE TABLE IF NOT EXISTS axes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, low TEXT, high TEXT);
    CREATE TABLE IF NOT EXISTS scores (
      paradigm_id INTEGER NOT NULL, axis_id INTEGER NOT NULL, score INTEGER NOT NULL, reason TEXT,
      PRIMARY KEY (paradigm_id, axis_id));
  `);
  // Columns that came after the first release. Adding them keeps each existing row.
  for (const [table, column] of [['hunts', 'stack'], ['components', 'paradigm_id'], ['snowmobiles', 'mismatch'],
    ['snowmobiles', 'problem'], ['snowmobiles', 'evidence_url'], ['snowmobiles', 'conventional'],
    ['snowmobiles', 'gain_axis'], ['snowmobiles', 'gain'], ['snowmobiles', 'problem_ids']]) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${column === 'paradigm_id' ? 'INTEGER' : 'TEXT'}`);
    }
  }
  // Add absent seeds on each start. Keep user rows, IDs and scores intact.
  const names = new Set(db.prepare(`SELECT name FROM paradigms`).all().map((p) => p.name.toLowerCase()));
  const add = db.prepare(`INSERT INTO paradigms (layer, name, summary, url) VALUES (?, ?, ?, ?)`);
  for (const [layer, list] of Object.entries(START)) for (const p of list) {
    const name = p[0].toLowerCase();
    if (!names.has(name)) { add.run(layer, ...p); names.add(name); }
  }
  // A run that stopped mid-job leaves a status that no job will finish.
  db.prepare(`UPDATE hunts SET status = 'failed', error = 'snowmobile stopped during this step'
    WHERE status IN ('hunting', 'creating')`).run();
  return db;
}

function token(db) {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'token'`).get();
  if (row) return row.value;
  const t = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO meta (key, value) VALUES ('token', ?)`).run(t);
  return t;
}

// ---------- stack ----------

// The four layers of a stack, from the program down to the machine and back up to the product.
const LAYERS = { language: 'Programming language', hardware: 'Hardware', os: 'Operating system', software: 'Software' };

// Reason: the Stack API had no sourced practical problems for the map or idea seed.
const PRACTICAL_PROBLEMS = {
  source: {
    title: 'Stack Overflow Developer Survey 2024: most common frustrations',
    url: 'https://survey.stackoverflow.co/2024/professional-developers/#2-most-common-frustrations',
    checked: '2026-10-28',
    respondents: 28251,
    scope: 'Professional Developer section, all respondents to the frustrations question.',
    measure: 'Share of respondents who select each frustration. Respondents can select more than one.',
    limit: 'These shares describe this survey sample. They do not measure severity or rank all practical problems.',
  },
  items: [
    { id: 'technical-debt', name: 'Technical debt', percent: 62.4 },
    { id: 'build-complexity', name: 'Build stack complexity', percent: 32.9 },
    { id: 'deployment-complexity', name: 'Deployment stack complexity', percent: 32.3 },
    { id: 'unreliable-tools', name: 'Tool and system unreliability', percent: 31.5 },
  ],
};

// The start list includes taxonomies, papers, project documentation and architecture styles.
const W = 'https://en.wikipedia.org/wiki/';
const START = {
  language: [
    ['Imperative programming', 'A program is a sequence of commands that change named, mutable state.', `${W}Imperative_programming`],
    ['Functional programming', 'A program is the composition of pure functions over immutable values.', `${W}Functional_programming`],
    ['Object-oriented programming', 'Objects bundle state with the methods that change it and send messages to each other.', `${W}Object-oriented_programming`],
    ['Logic programming', 'A program is a set of facts and rules, and a search engine derives the answers.', `${W}Logic_programming`],
    ['Constraint programming', 'The programmer states relations between variables and a solver finds the values.', 'https://docs.minizinc.dev/en/stable/modelling.html'],
    ['Actor model', 'Independent actors own their state and talk only through asynchronous messages.', `${W}Actor_model`],
    ['Dataflow programming', 'Operations run when their inputs arrive, so the graph of data sets the order.', `${W}Dataflow_programming`],
    ['Functional reactive programming', 'Values that change over time are first-class and the runtime propagates each change.', `${W}Functional_reactive_programming`],
    ['Concatenative programming', 'Adjacent program fragments compose functions, usually over a shared data stack.', 'https://concatenative.org/wiki/view/Concatenative%20language'],
    ['Ownership types', 'The compiler checks one owner per value and releases the value when its owner leaves scope.', 'https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html'],
    ['Algebraic effects', 'Programs declare effect operations, and handlers define how those operations execute and resume.', 'https://koka-lang.github.io/koka/doc/book.html'],
  ],
  hardware: [
    ['Pipelined RISC processor', 'Simple fixed-length instructions overlap in a five-stage pipeline.', `${W}Classic_RISC_pipeline`],
    ['Out-of-order superscalar', 'Hardware finds independent instructions at run time and issues several in each cycle.', `${W}Out-of-order_execution`],
    ['VLIW', 'The compiler packs independent operations into one long instruction at build time.', `${W}Very_long_instruction_word`],
    ['Vector processor', 'One instruction operates on a whole vector of data elements.', 'https://docs.riscv.org/reference/isa/v20260120/unpriv/v-st-ext.html'],
    ['GPU (SIMT)', 'Thousands of threads run in lockstep groups and hide memory latency by switching groups.', `${W}Single_instruction,_multiple_threads`],
    ['Shared-memory multiprocessor', 'Several cores share one coherent address space through caches.', `${W}Symmetric_multiprocessing`],
    ['Cluster (warehouse-scale computer)', 'Many cheap servers connected by a network act as one computer.', `${W}Computer_cluster`],
    ['Domain-specific accelerator', 'Hardware built for one class of work, such as the systolic arrays of a TPU.', 'https://research.google/pubs/in-datacenter-performance-analysis-of-a-tensor-processing-unit/'],
    ['Reconfigurable logic (FPGA)', 'Configurable logic blocks and interconnect form circuits rather than execute a fixed instruction stream.', 'https://docs.amd.com/r/en-US/ug474_7Series_CLB/CLB-Overview?contentId=Iu8f5wALojKVM4rTwaBPtw'],
    ['Neuromorphic hardware', 'Artificial neurons exchange sparse events, with memory and computation close together.', 'https://www.intel.com/content/www/us/en/research/neuromorphic-computing.html'],
    ['Hardware root of trust', 'Dedicated secure silicon provides a trust anchor for boot verification and device attestation.', 'https://opentitan.org/book/doc/introduction.html'],
    ['Hardware generators', 'A parameterized program composes hardware components and emits a circuit description for a selected configuration.', 'https://www2.eecs.berkeley.edu/Pubs/TechRpts/2016/EECS-2016-17.html'],
  ],
  os: [
    ['Monolithic kernel', 'All operating system services run in one privileged address space.', `${W}Monolithic_kernel`],
    ['Microkernel', 'The kernel keeps only address spaces, threads and IPC; services run as user processes.', `${W}Microkernel`],
    ['Exokernel', 'The kernel only multiplexes hardware safely and libraries implement the abstractions.', 'https://pdos.csail.mit.edu/6.828/2008/readings/engler95exokernel.pdf'],
    ['Unikernel', 'One application and the library OS that it needs compile into one single-address-space image.', `${W}Unikernel`],
    ['Hypervisor', 'A thin layer runs several complete operating systems on virtual hardware.', `${W}Hypervisor`],
    ['Capability-based OS', 'A process can use a resource only through an unforgeable capability that names it.', `${W}Capability-based_security`],
    ['Real-time OS', 'The scheduler guarantees that each task meets its deadline.', `${W}Real-time_operating_system`],
    ['Distributed OS', 'Networked machines provide system resources through common interfaces and a unified resource view.', 'https://9p.io/sys/doc/9.html'],
    ['Multikernel', 'Independent kernels on each core coordinate through explicit messages and replicate state rather than share it.', 'https://barrelfish.org/publications/barrelfish_sosp09.pdf'],
    ['Splitkernel', 'Separate monitors manage processor, memory and storage components across a network instead of one complete server.', 'https://www.usenix.org/conference/osdi18/presentation/shan'],
    ['Separation kernel', 'The kernel isolates applications through fixed resource partitions and explicit controls on information flow.', 'https://muen.sk/'],
    ['Single-level store', 'The OS extends memory addresses to persistent storage, so applications use memory objects instead of separate file operations.', 'https://www.usenix.org/legacy/event/usenix02/shapiro.html'],
  ],
  software: [
    ['Client-server', 'Clients send requests to a central server that owns the data.', `${W}Client%E2%80%93server_model`],
    ['Peer-to-peer', 'Equal peers share resources directly without a central server.', 'https://docs.ipfs.tech/concepts/how-ipfs-works/'],
    ['Event-driven architecture', 'Components publish events and other components react to them.', `${W}Event-driven_architecture`],
    ['Pipes and filters', 'Each filter transforms a stream and passes it to the next filter.', `${W}Pipeline_(software)`],
    ['Microservices', 'Small services that each own their data talk over the network.', `${W}Microservices`],
    ['Serverless', 'The platform runs a function for each request and bills only that run.', `${W}Serverless_computing`],
    ['Local-first software', 'The primary copy of the data lives on the device and syncs to others when it can.', 'https://www.inkandswitch.com/local-first/'],
    ['Event sourcing', 'The state is the result of replaying an append-only log of events.', 'https://martinfowler.com/eaaDev/EventSourcing.html'],
    ['CQRS', 'Separate models handle commands that change data and queries that read data.', 'https://martinfowler.com/bliki/CQRS.html'],
    ['Embedded database', 'The database engine executes inside the application process and accesses files without a separate server.', 'https://www.sqlite.org/serverless.html'],
    ['Functional package management', 'Packages are immutable values with explicit dependencies, so new versions coexist without changes to old versions.', 'https://nix.dev/manual/nix/2.35/introduction.html'],
    ['Dependency injection', 'External configuration supplies component dependencies, so each component can use an interface without a fixed implementation.', 'https://martinfowler.com/articles/injection.html'],
    ['Data structure server', 'A server stores native data structures and exposes commands that operate on their contents directly.', 'https://redis.io/docs/latest/develop/data-types/'],
    ['Conflict-free replicated data types', 'Replicas accept independent updates and merge concurrent changes into the same state without a central coordinator.', 'https://crdt.tech/'],
  ],
};

// A gap of this size or more (out of 10) on one axis is a mismatch between the layers of a stack.
const MISMATCH = 5;

// Reason: the API trial found zero links and no measure of problems without a documented reduction.
const PROBLEM_LINKS = [
  // Reason: the accelerator trial found no assessments and four problem gaps.
  {
    paradigm: 'Domain-specific accelerator', layer: 'hardware', problem_id: 'build-complexity', effect: 'worsens',
    reason: 'Coral requires model conversion, 8-bit quantization and Edge TPU compilation for custom models. Assessment: these target requirements can add build work. The cost depends on model compatibility and toolchain choices. This does not apply to every accelerator or imply manual execution of each step.',
    source: { title: 'Coral: TensorFlow model compatibility with Edge TPU', url: 'https://coral.ai/docs/edgetpu/models-intro/' },
  },
  // Reason: the Imperative programming trial found no assessments and four problem gaps.
  {
    paradigm: 'Imperative programming', layer: 'language', problem_id: 'unreliable-tools', effect: 'worsens',
    reason: 'The Clojure essay describes error-prone coordination when concurrent tasks change shared mutable state. Assessment: incorrect coordination can cause faults. This cost requires concurrent access to shared mutable state and depends on synchronization controls. It does not imply faults in every imperative program.',
    source: { title: 'Clojure: imperative state and concurrency', url: 'https://clojure.org/about/state#_imperative_programming' },
  },
  // Reason: the VLIW trial found no assessments and four problem gaps.
  {
    paradigm: 'VLIW', layer: 'hardware', problem_id: 'technical-debt', effect: 'worsens',
    reason: 'TI C6000 linear assembly can require code refinement and explicit register constraints for adequate performance. Assessment: target-specific assembly can add maintenance work. The optimizer handles instruction order and register allocation by default. The cost depends on performance needs and source choices. This does not apply to every VLIW program.',
    source: { title: 'TI C6000: linear assembly requirements', url: 'https://downloads.ti.com/docs/esd/SPRUI04/what-you-need-to-know-to-write-linear-assembly-spru1874615.html' },
  },
  {
    paradigm: 'VLIW', layer: 'hardware', problem_id: 'unreliable-tools', effect: 'worsens',
    reason: 'TI warns that its linear assembly optimizer may accept illegal assembly with explicit instruction schedules and produce unintended results. Assessment: this input error can cause application faults. The risk requires invalid optimizer input. Correct linear assembly leaves instruction order optimization to the tool. This does not imply faults in every VLIW program.',
    source: { title: 'TI C6000: invalid assembly input', url: 'https://downloads.ti.com/docs/esd/SPRUI04/what-you-need-to-know-to-write-linear-assembly-spru1874615.html' },
  },
  // Reason: the Vector processor trial found no assessments and four problem gaps.
  {
    paradigm: 'Vector processor', layer: 'hardware', problem_id: 'technical-debt', effect: 'reduces',
    reason: 'RISC-V V permits one binary to run across different vector register lengths under stated constraints. Assessment: portable vector code can reduce duplicate implementations for different register lengths. The benefit requires compatible element types, instructions and portable code. This does not address all technical debt or apply to every vector processor.',
    source: { title: 'RISC-V V 1.0: implementation parameters and portable code', url: 'https://raw.githubusercontent.com/riscv/riscv-v-spec/v1.0/v-spec.adoc' },
  },
  // Reason: the Hardware root of trust trial found no assessments and four problem gaps.
  {
    paradigm: 'Hardware root of trust', layer: 'hardware', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'OpenTitan Earl Grey checks code signatures before control passes to device owner code. Assessment: these checks can prevent faults from unauthorized boot code. The benefit requires trusted keys and correct verification controls. Authorized code can still contain faults. The source marks this overview Pre-RFC. This does not prove whole-system reliability or apply to every hardware root of trust.',
    source: { title: 'OpenTitan Earl Grey: secure boot', url: 'https://opentitan.org/book/doc/security/specs/secure_boot/' },
  },
  {
    paradigm: 'Hardware root of trust', layer: 'hardware', problem_id: 'deployment-complexity', effect: 'worsens',
    reason: 'OpenTitan Earl Grey requires valid code signatures from trusted keys and fails to boot after verification errors. Assessment: firmware releases can require extra key and signature controls to avoid deployment failures. The cost depends on key configuration and release procedures. The source marks this overview Pre-RFC. This does not apply to every hardware root of trust.',
    source: { title: 'OpenTitan Earl Grey: secure boot', url: 'https://opentitan.org/book/doc/security/specs/secure_boot/' },
  },
  // Reason: the FPGA trial found no assessments and four problem gaps.
  {
    paradigm: 'Reconfigurable logic (FPGA)', layer: 'hardware', problem_id: 'build-complexity', effect: 'worsens',
    reason: 'Vivado exposes synthesis and implementation run options before bitstream creation. Assessment: these options can add build configuration work for FPGA designs. The Generate Bitstream command runs prerequisite stages automatically. The cost depends on the design and run options. This does not apply to every FPGA toolchain or imply manual execution of each stage.',
    source: { title: 'AMD Vivado tutorial: synthesis and implementation run options', url: 'https://docs.amd.com/r/2024.1-English/ug888-vivado-design-flows-overview-tutorial/Step-7-Synthesizing-and-Implementing-the-Design' },
  },
  // Reason: the Monolithic kernel trial found no assessments and four problem gaps.
  {
    paradigm: 'Monolithic kernel', layer: 'os', problem_id: 'technical-debt', effect: 'worsens',
    reason: 'Linux changes internal kernel interfaces and updates drivers in its source tree together. Assessment: drivers outside that tree can require extra maintenance after interface changes. The userspace interface stays stable. This cost does not apply to every monolithic kernel or ordinary application.',
    source: { title: 'Linux: internal driver interfaces and maintenance', url: 'https://docs.kernel.org/process/stable-api-nonsense.html' },
  },
  {
    paradigm: 'Monolithic kernel', layer: 'os', problem_id: 'build-complexity', effect: 'worsens',
    reason: 'Linux documents separate module builds for different kernel configurations, compiler versions and processor architectures. Assessment: support for multiple kernel variants can add driver build work. The cost depends on the supported variants. This does not apply to every monolithic kernel or ordinary application.',
    source: { title: 'Linux: binary kernel interface and module builds', url: 'https://docs.kernel.org/process/stable-api-nonsense.html' },
  },
  // Reason: the Cluster trial found no assessments and four problem gaps.
  {
    paradigm: 'Cluster (warehouse-scale computer)', layer: 'hardware', problem_id: 'unreliable-tools', effect: 'worsens',
    reason: 'MPI requires a suitable send and receive order to avoid deadlock with synchronous communication. Assessment: incorrect message order can stop a cluster application. The risk depends on the communication pattern and protocol controls. MPI asynchronous operations can avoid this order constraint. This does not imply faults in every cluster application or apply to every cluster protocol.',
    source: { title: 'MPI 5.0: asynchronous communication and deadlock', url: 'https://www.mpi-forum.org/docs/mpi-5.0/mpi50-report/node73.htm' },
  },
  // Reason: the shared-memory trial found no assessments and four problem gaps.
  {
    paradigm: 'Shared-memory multiprocessor', layer: 'hardware', problem_id: 'unreliable-tools', effect: 'worsens',
    reason: 'OpenMP states that a data race between threads leaves the program result unspecified. Assessment: unordered access to shared memory can cause application faults. The risk depends on shared data access and synchronization controls. This does not imply faults in every shared-memory program or apply to every shared-memory model.',
    source: { title: 'OpenMP 5.2: memory model and data races', url: 'https://www.openmp.org/spec-html/5.2/openmpsu9.html' },
  },
  // Reason: the GPU trial found no assessments and four problem gaps.
  {
    paradigm: 'GPU (SIMT)', layer: 'hardware', problem_id: 'unreliable-tools', effect: 'worsens',
    reason: 'CUDA documents undefined behavior from data races when atomic scopes do not include all participant threads. Assessment: incorrect synchronization scopes can cause application faults. The risk depends on shared memory access and synchronization controls. This does not imply faults in every GPU program or apply to every GPU platform.',
    source: { title: 'CUDA guide: data races and thread scopes', url: 'https://docs.nvidia.com/cuda/cuda-programming-guide/05-appendices/cuda-cpp-memory-model.html#data-races' },
  },
  {
    paradigm: 'GPU (SIMT)', layer: 'hardware', problem_id: 'build-complexity', effect: 'worsens',
    reason: 'CUDA requires a compatible host compiler for nvcc. Separate device compilation requires explicit compiler flags and device linkage. Assessment: these requirements can add build configuration work. nvcc coordinates compiler steps automatically. The cost depends on toolchain compatibility and compilation mode. This does not apply to every GPU toolchain.',
    source: { title: 'CUDA guide: NVCC workflow and separate compilation', url: 'https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/nvcc.html' },
  },
  // Reason: the Real-time OS trial found no assessments and four problem gaps.
  {
    paradigm: 'Real-time OS', layer: 'os', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'FreeRTOS MPU ports restrict task access to memory and peripherals. Assessment: this can contain faults from unauthorized task memory access. The benefit requires suitable hardware, an MPU port and correct access permissions. Privileged code still needs controls. This does not prove whole-system reliability or apply to every real-time OS.',
    source: { title: 'FreeRTOS: MPU costs and benefits', url: 'https://github.com/FreeRTOS/FreeRTOS-Website-Content/blob/main/content/en-us/Security/04-FreeRTOS-MPU-memory-protection-unit.md' },
  },
  {
    paradigm: 'Real-time OS', layer: 'os', problem_id: 'technical-debt', effect: 'worsens',
    reason: 'FreeRTOS states that MPU restrictions add application design complexity. Developers must define memory regions and respect task access limits. Assessment: these constraints can add maintenance work. The cost depends on the memory layout and task boundaries. This does not apply to every real-time OS.',
    source: { title: 'FreeRTOS: MPU costs and benefits', url: 'https://github.com/FreeRTOS/FreeRTOS-Website-Content/blob/main/content/en-us/Security/04-FreeRTOS-MPU-memory-protection-unit.md' },
  },
  // Reason: the Exokernel trial found no assessments and four problem gaps.
  {
    paradigm: 'Exokernel', layer: 'os', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'The Exokernel paper describes library OS isolation. Wrong arguments from an application affect only that application. Assessment: this can contain faults from invalid library calls. The benefit requires correct kernel resource protection. This does not prove whole-system reliability or apply to every exokernel.',
    source: { title: 'Exokernel: library OS isolation, section 2.2', url: 'https://pdos.csail.mit.edu/6.828/2008/readings/engler95exokernel.pdf' },
  },
  {
    paradigm: 'Exokernel', layer: 'os', problem_id: 'technical-debt', effect: 'worsens',
    reason: 'The Exokernel paper states that direct kernel interfaces expose hardware-specific information and prevent application portability. Assessment: this can add hardware-dependent maintenance work. The cost applies to direct interface use. A library OS with a standard interface can preserve portability. This does not apply to every exokernel application.',
    source: { title: 'Exokernel: library OS portability, section 2.2', url: 'https://pdos.csail.mit.edu/6.828/2008/readings/engler95exokernel.pdf' },
  },
  // Reason: the Splitkernel trial found no assessment and four problem gaps.
  {
    paradigm: 'Splitkernel', layer: 'os', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'LegoOS uses backup logs to restore memory after a primary memory component fails. Assessment: this can reduce application failures from memory component faults. The benefit requires intact backup logs. A full backup log can stop replication and leave memory without recovery. Applications must protect persistent data and handle processor faults. This does not prove whole-system reliability or apply to every splitkernel.',
    source: { title: 'LegoOS: memory fault tolerance, section 4.7', url: 'https://www.usenix.org/system/files/osdi18-shan.pdf' },
  },
  // Reason: the Multikernel trial found no assessments and four problem gaps.
  {
    paradigm: 'Multikernel', layer: 'os', problem_id: 'technical-debt', effect: 'reduces',
    reason: 'The Barrelfish paper separates hardware transport and device interfaces from OS structure. Assessment: this can reduce code changes across components for new hardware. The benefit requires hardware details to remain behind these interfaces. This does not address all technical debt or apply to every multikernel.',
    source: { title: 'The Multikernel: hardware-neutral OS structure, section 3.2', url: 'https://barrelfish.org/publications/barrelfish_sosp09.pdf' },
  },
  {
    paradigm: 'Multikernel', layer: 'os', problem_id: 'technical-debt', effect: 'worsens',
    reason: 'The Barrelfish paper identifies obscure control flow as a concern with asynchronous messages. Assessment: this can make code maintenance harder. The cost depends on message handlers and control flow tools. This does not apply to every multikernel.',
    source: { title: 'The Multikernel: message-based software concerns, section 2.6', url: 'https://barrelfish.org/publications/barrelfish_sosp09.pdf' },
  },
  // Reason: the Concatenative programming trial found no assessment and four problem gaps.
  {
    paradigm: 'Concatenative programming', layer: 'language', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'Factor checks declared input and output counts before words execute. Its compiler rejects words that fail the stack checker. Assessment: these checks can prevent faults from invalid stack effects. The benefit requires code that passes the static stack checker. Dynamic code still needs controls. This does not prove whole-system reliability or apply to every concatenative language.',
    source: { title: 'Factor handbook: stack effect checks', url: 'https://docs.factorcode.org/content/article-inference.html' },
  },
  // Reason: the Functional reactive programming trial found no assessment and four problem gaps.
  {
    paradigm: 'Functional reactive programming', layer: 'language', problem_id: 'technical-debt', effect: 'reduces',
    reason: 'Reactive-banana provides combinators to filter, merge and accumulate events and compose values that vary with time. Assessment: these shared operations can reduce custom event coordination code. The benefit requires event and value models that fit the application. External effects still need controls. This does not address all technical debt or apply to every functional reactive program.',
    source: { title: 'Reactive-banana: event and behavior combinators', url: 'https://hackage-content.haskell.org/package/reactive-banana-1.3.2.0/docs/Reactive-Banana-Combinators.html' },
  },
  // Reason: the Logic programming trial found no assessment and four problem gaps.
  {
    paradigm: 'Logic programming', layer: 'language', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'SWI-Prolog documents tabled execution that avoids infinite recursion in a finite graph query. Assessment: this can prevent query failure through nontermination. The benefit requires suitable tabled predicates. This does not guarantee termination for every query or whole-system reliability or apply to every logic program.',
    source: { title: 'SWI-Prolog: recursive query termination', url: 'https://www.swi-prolog.org/pldoc/man?section=tabling-non-termination' },
  },
  {
    paradigm: 'Logic programming', layer: 'language', problem_id: 'unreliable-tools', effect: 'worsens',
    reason: 'SWI-Prolog documents that default answer tables do not automatically reflect changes to their source predicates. Assessment: stale answers can cause incorrect results after facts change. Control requires explicit table invalidation or suitable incremental tables. This does not apply to every logic program.',
    source: { title: 'SWI-Prolog: answer table consistency', url: 'https://www.swi-prolog.org/pldoc/man?section=tabling' },
  },
  // Reason: the Object-oriented programming trial found no assessment and four problem gaps.
  {
    paradigm: 'Object-oriented programming', layer: 'language', problem_id: 'technical-debt', effect: 'reduces',
    reason: 'Oracle documents independent object maintenance and access to internal state through methods. Assessment: encapsulation can reduce dependencies on internal implementation details. This requires stable method contracts and encapsulated state. This does not address all technical debt or apply to every object-oriented design.',
    source: { title: 'Oracle Java Tutorials: objects and encapsulation', url: 'https://docs.oracle.com/javase/tutorial/java/concepts/object.html' },
  },
  // Reason: the Dataflow programming trial found no assessment and four problem gaps.
  {
    paradigm: 'Dataflow programming', layer: 'language', problem_id: 'technical-debt', effect: 'reduces',
    reason: 'Apache Beam supports reusable composite transforms in dataflow pipelines. Assessment: shared transforms can reduce duplicate pipeline code. This requires compatible transform interfaces. This does not address all technical debt or apply to every dataflow system.',
    source: { title: 'Apache Beam: composite transforms', url: 'https://beam.apache.org/documentation/programming-guide/#composite-transforms' },
  },
  {
    paradigm: 'Dataflow programming', layer: 'language', problem_id: 'unreliable-tools', effect: 'worsens',
    reason: 'Apache Beam can execute transform functions more than once after a retry. Assessment: repeat external updates can cause incorrect state without idempotent operations. This risk depends on the runner and external effect controls. This does not apply to every dataflow system.',
    source: { title: 'Apache Beam: idempotence', url: 'https://beam.apache.org/documentation/programming-guide/#idempotence' },
  },
  // Reason: the Client-server trial found no assessment and four problem gaps.
  {
    paradigm: 'Client-server', layer: 'software', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'SQLite documents that stray pointers in a database client cannot corrupt memory in a separate database server process. Assessment: process isolation can contain client memory faults. The benefit requires a separate server process. Authorized requests can still cause faults. This does not prove whole-system reliability or apply to every client-server system.',
    source: { title: 'SQLite: database server process isolation', url: 'https://www.sqlite.org/serverless.html' },
  },
  {
    paradigm: 'Client-server', layer: 'software', problem_id: 'deployment-complexity', effect: 'worsens',
    reason: 'SQLite contrasts embedded databases with a separate database server that needs installation, configuration and administration. Assessment: a self-managed database server adds deployment work. A managed service can transfer server administration to the provider. This cost does not apply to every client-server system.',
    source: { title: 'SQLite: database server administration', url: 'https://www.sqlite.org/serverless.html' },
  },
  // Reason: the Distributed OS trial found no assessment and four problem gaps.
  {
    paradigm: 'Distributed OS', layer: 'os', problem_id: 'technical-debt', effect: 'reduces',
    reason: 'Plan 9 exposes local and remote resources through file interfaces and the 9P protocol. Applications can use the same file operations for both. Assessment: this can reduce custom resource access code. The benefit requires services that expose compatible file interfaces. This does not address all technical debt or apply to every distributed OS.',
    source: { title: 'Plan 9 from Bell Labs: Design', url: 'https://9p.io/sys/doc/9.html' },
  },
  // Reason: the Hardware generators trial found no assessment and four problem gaps.
  {
    paradigm: 'Hardware generators', layer: 'hardware', problem_id: 'technical-debt', effect: 'reduces',
    reason: 'Rocket Chip composes core, cache and interconnect generators from a library into a system on a chip. Assessment: reuse can reduce duplicate circuit description code across configurations. The benefit requires compatible generator interfaces. Generated circuits still need validation. This does not address all technical debt or apply to every hardware generator.',
    source: { title: 'UC Berkeley: The Rocket Chip Generator', url: 'https://www2.eecs.berkeley.edu/Pubs/TechRpts/2016/EECS-2016-17.html' },
  },
  // Reason: the Hypervisor trial found no assessment and four problem gaps.
  {
    paradigm: 'Hypervisor', layer: 'os', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'Xen permits a device driver to run in a separate virtual machine. After a driver crash, Xen can restart that virtual machine without damage to the rest of the system. Assessment: this can contain driver faults. The benefit requires driver isolation. This does not prove whole-system reliability or apply to every hypervisor.',
    source: { title: 'Xen Project: Hypervisor driver isolation', url: 'https://xenproject.org/projects/hypervisor/' },
  },
  // Reason: the Capability-based OS trial found no assessment and four problem gaps.
  {
    paradigm: 'Capability-based OS', layer: 'os', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'In seL4, capabilities control access to kernel objects and resources. Each capability specifies access rights. Assessment: this can limit damage from unauthorized resource operations. The benefit requires correct capability allocation. Authorized code can still cause faults. This does not prove whole-system reliability or apply to every capability-based OS.',
    source: { title: 'seL4 tutorial: capabilities', url: 'https://docs.sel4.systems/Tutorials/capabilities.html' },
  },
  // Reason: the Unikernel trial found no assessment and four problem gaps.
  {
    paradigm: 'Unikernel', layer: 'os', problem_id: 'deployment-complexity', effect: 'reduces',
    reason: 'The Mirage paper integrates service configuration into library calls and compiler checks instead of separate application configuration files. Assessment: this can reduce configuration work for compatible services. The benefit requires libraries that fit the application. This does not remove all deployment costs or apply to every unikernel.',
    source: { title: 'ASPLOS 2013: Unikernels, sections 2.1 and 2.2', url: 'https://dave.recoil.org/papers/final/asplos2013.pdf' },
  },
  {
    paradigm: 'Unikernel', layer: 'os', problem_id: 'deployment-complexity', effect: 'worsens',
    reason: 'The Mirage paper states that fully static configuration requires a new compilation to reconfigure a service. Assessment: this can add build work to configuration changes. This cost depends on which parameters are static and does not apply to every configuration change.',
    source: { title: 'ASPLOS 2013: Unikernels, sections 2.1 and 2.2', url: 'https://dave.recoil.org/papers/final/asplos2013.pdf' },
  },
  // Reason: the Constraint programming trial found no assessment and four problem gaps.
  {
    paradigm: 'Constraint programming', layer: 'language', problem_id: 'technical-debt', effect: 'reduces',
    reason: 'MiniZinc separates model parameters from constraints through data files. The handbook reuses one model with different data files. Assessment: this can reduce duplicate constraint code and model edits for each dataset. The benefit requires a reusable model. This does not address all technical debt or prove that the constraints match the real problem.',
    source: { title: 'MiniZinc Handbook: data files and assertions', url: 'https://docs.minizinc.dev/en/stable/modelling.html#datafiles-and-assertions' },
  },
  // Reason: the Single-level store trial found no assessments and four problem gaps.
  {
    paradigm: 'Single-level store', layer: 'os', problem_id: 'technical-debt', effect: 'reduces',
    reason: 'The EROS paper describes one memory model across volatile and persistent storage. Assessment: this can reduce custom code at the storage boundary. This requires the single-level store model and does not address all technical debt.',
    source: { title: 'USENIX: design evolution of the EROS single-level store', url: 'https://www.usenix.org/legacy/event/usenix02/shapiro.html' },
  },
  {
    paradigm: 'Single-level store', layer: 'os', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'The EROS paper describes transactional updates for globally consistent durable state. Assessment: this can prevent inconsistent stored state after a crash. Correct application transactions remain necessary. This does not prove whole-system reliability or apply to every persistent memory system.',
    source: { title: 'USENIX: design evolution of the EROS single-level store', url: 'https://www.usenix.org/legacy/event/usenix02/shapiro.html' },
  },
  // Reason: the Algebraic effects trial found no assessment and four problem gaps.
  {
    paradigm: 'Algebraic effects', layer: 'language', problem_id: 'technical-debt', effect: 'reduces',
    reason: 'Koka documents composable effect handlers that implement control abstractions as libraries instead of separate language extensions. Assessment: this can reduce maintenance costs from custom control mechanisms. This requires suitable handler interfaces and does not address all technical debt.',
    source: { title: 'Koka: typed effect handlers', url: 'https://koka-lang.github.io/koka/doc/book.html' },
  },
  {
    paradigm: 'Algebraic effects', layer: 'language', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'Koka tracks effects in function types and requires a handler for the documented yield effect. Assessment: this can expose absent effect handlers before execution. Correct handler behavior still needs checks. This does not prove whole-system reliability or apply to every algebraic effect implementation.',
    source: { title: 'Koka: typed effect handlers', url: 'https://koka-lang.github.io/koka/doc/book.html' },
  },
  // Reason: the Separation kernel trial found no assessment and four problem gaps.
  {
    paradigm: 'Separation kernel', layer: 'os', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'Muen documents component isolation with communication only through a security policy. Assessment: this can contain faults from unauthorized component memory access. The benefit requires a correct isolation policy. This does not prove whole-system reliability or apply to every separation kernel.',
    source: { title: 'Muen: component isolation and system policy', url: 'https://muen.sk/' },
  },
  // Reason: the Data structure server trial found no assessment and four problem gaps.
  {
    paradigm: 'Data structure server', layer: 'software', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'Redis documents append-only logs that replay writes to restore data after a restart. Assessment: this supports recovery after process faults. Recovery requires intact persistence files. This does not prove whole-system reliability or apply to every data structure server.',
    source: { title: 'Redis: persistence and recovery limits', url: 'https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/' },
  },
  {
    paradigm: 'Data structure server', layer: 'software', problem_id: 'unreliable-tools', effect: 'worsens',
    reason: 'Redis documents that periodic snapshots can lose recent writes after an unexpected shutdown. Assessment: a snapshot-only setup can lose updates between snapshots. This risk depends on the persistence policy and does not apply to every data structure server.',
    source: { title: 'Redis: persistence and recovery limits', url: 'https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/' },
  },
  // Reason: the Microservices trial found only deployment harm and four problem gaps.
  {
    paradigm: 'Microservices', layer: 'software', problem_id: 'technical-debt', effect: 'reduces',
    reason: 'Microsoft describes separate service codebases and private data stores that reduce code dependencies. Assessment: this can reduce debt from cross-component changes. This requires suitable service boundaries and does not address all technical debt. Cross-service changes still add maintenance costs.',
    source: { title: 'Azure Architecture Center: microservices benefits', url: 'https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/microservices#benefits' },
  },
  {
    paradigm: 'Microservices', layer: 'software', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'Microsoft describes fault isolation when upstream services handle downstream faults correctly. Assessment: this can contain faults within one unavailable service. The benefit requires fault controls in dependent services. This does not prove whole-system reliability.',
    source: { title: 'Azure Architecture Center: microservices benefits', url: 'https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/microservices#benefits' },
  },
  // Reason: the Functional programming trial found no assessment and four problem gaps.
  {
    paradigm: 'Functional programming', layer: 'language', problem_id: 'technical-debt', effect: 'reduces',
    reason: 'Clojure documents local function behavior that makes pure functions easier to understand and test. Assessment: this can reduce maintenance costs from hidden effects. This applies to the pure portion of a program and does not address all technical debt.',
    source: { title: 'Clojure: pure functions and state', url: 'https://clojure.org/about/state#_functional_programming' },
  },
  {
    paradigm: 'Functional programming', layer: 'language', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'Clojure documents that pure functions have no mutable state to coordinate between threads. Assessment: this can prevent concurrency faults within pure code. Effects and shared state still need controls. This does not prove whole-system reliability.',
    source: { title: 'Clojure: pure functions and state', url: 'https://clojure.org/about/state#_functional_programming' },
  },
  // Reason: the CRDT trial found no assessment and four problem gaps.
  {
    paradigm: 'Conflict-free replicated data types', layer: 'software', problem_id: 'technical-debt', effect: 'reduces',
    reason: 'The CRDT reference describes automatic conflict resolution without custom conflict resolution code. Assessment: this can reduce debt from application-specific merge code. This requires suitable data types and does not address all technical debt.',
    source: { title: 'CRDT reference: conflict resolution and offline replicas', url: 'https://crdt.tech/' },
  },
  {
    paradigm: 'Conflict-free replicated data types', layer: 'software', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'The CRDT reference describes independent updates on offline replicas and a consistent state after merge. Assessment: this can preserve local updates through network outages. Convergence does not prove application correctness or protect against device loss.',
    source: { title: 'CRDT reference: conflict resolution and offline replicas', url: 'https://crdt.tech/' },
  },
  // Reason: the Peer-to-peer trial found no assessment and four problem gaps.
  {
    paradigm: 'Peer-to-peer', layer: 'software', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'IPFS documents remote copies that preserve access when the original device goes offline. Assessment: retained copies on reachable peers can reduce outage effects. This requires explicit data retention and does not prove whole-system reliability.',
    source: { title: 'IPFS: data retention and availability limits', url: 'https://docs.ipfs.tech/concepts/persistence/' },
  },
  {
    paradigm: 'Peer-to-peer', layer: 'software', problem_id: 'unreliable-tools', effect: 'worsens',
    reason: 'IPFS can delete cached data to free disk space. Assessment: reliance on temporary peer caches can cause data loss without explicit retention. This risk depends on retained copies, not every peer-to-peer system.',
    source: { title: 'IPFS: data retention and availability limits', url: 'https://docs.ipfs.tech/concepts/persistence/' },
  },
  // Reason: the Event-driven architecture trial found no assessment and four problem gaps.
  {
    paradigm: 'Event-driven architecture', layer: 'software', problem_id: 'technical-debt', effect: 'reduces',
    reason: 'Microsoft describes new consumers without changes to producers or other consumers. Assessment: this can reduce debt from direct component dependencies. Event contracts still need maintenance. This does not address all technical debt.',
    source: { title: 'Azure Architecture Center: event dependencies and data loss', url: 'https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven' },
  },
  {
    paradigm: 'Event-driven architecture', layer: 'software', problem_id: 'unreliable-tools', effect: 'worsens',
    reason: 'Microsoft warns that a component crash before event transfer can cause data loss. Assessment: this can leave downstream state incomplete. This risk depends on durable event storage and receipt controls, not every event-driven system.',
    source: { title: 'Azure Architecture Center: event dependencies and data loss', url: 'https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven' },
  },
  // Reason: the Pipes and filters trial found no assessment and four problem gaps.
  {
    paradigm: 'Pipes and filters', layer: 'software', problem_id: 'technical-debt', effect: 'reduces',
    reason: 'Microsoft describes independent filters that replace duplicate pipeline logic. Assessment: shared filters can reduce debt from duplicate code. This requires compatible data schemas and does not address all technical debt.',
    source: { title: 'Azure Architecture Center: filter reuse and fault costs', url: 'https://learn.microsoft.com/en-us/azure/architecture/patterns/pipes-and-filters' },
  },
  {
    paradigm: 'Pipes and filters', layer: 'software', problem_id: 'unreliable-tools', effect: 'worsens',
    reason: 'Microsoft warns that retries after filter faults can repeat state updates. Assessment: repeat updates can corrupt downstream state. This cost depends on retry controls and whether repeat operations preserve the result.',
    source: { title: 'Azure Architecture Center: filter reuse and fault costs', url: 'https://learn.microsoft.com/en-us/azure/architecture/patterns/pipes-and-filters' },
  },
  // Reason: the Serverless trial found no assessment and four problem gaps.
  {
    paradigm: 'Serverless', layer: 'software', problem_id: 'deployment-complexity', effect: 'reduces',
    reason: 'AWS Lambda manages servers, capacity and patches. Assessment: this removes server setup and maintenance from application deployment. Application configuration and service integration costs remain.',
    source: { title: 'AWS Lambda: managed infrastructure', url: 'https://docs.aws.amazon.com/lambda/latest/dg/welcome.html' },
  },
  {
    paradigm: 'Serverless', layer: 'software', problem_id: 'unreliable-tools', effect: 'worsens',
    reason: 'AWS Lambda Event Functions reject requests when no concurrency capacity remains. Assessment: shared account limits can cause request failures across functions. This cost depends on demand, quotas and concurrency controls, not every serverless application.',
    source: { title: 'AWS Lambda: concurrency limits and controls', url: 'https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html' },
  },
  // Reason: the Local-first software trial found no assessment and four problem gaps.
  {
    paradigm: 'Local-first software', layer: 'software', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'Ink & Switch describes local data access without a network connection. Assessment: local operations can continue through a network outage. This does not protect against device loss or local faults.',
    source: { title: 'Ink & Switch: local-first benefits and prototype costs', url: 'https://www.inkandswitch.com/essay/local-first/' },
  },
  {
    paradigm: 'Local-first software', layer: 'software', problem_id: 'unreliable-tools', effect: 'worsens',
    reason: 'Ink & Switch reports performance, memory and disk costs from CRDT change history in its prototypes. Assessment: retained history can exhaust device resources. This cost depends on the implementation and workload, not every local-first application.',
    source: { title: 'Ink & Switch: local-first benefits and prototype costs', url: 'https://www.inkandswitch.com/essay/local-first/' },
  },
  // Reason: the Event sourcing trial found no assessment and four problem gaps.
  {
    paradigm: 'Event sourcing', layer: 'software', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'Fowler describes event replay to restore application state after a crash. Assessment: a retained event log can support state recovery. This does not prevent every fault or replace protection for the event log.',
    source: { title: 'Martin Fowler: event replay and external updates', url: 'https://martinfowler.com/eaaDev/EventSourcing.html' },
  },
  {
    paradigm: 'Event sourcing', layer: 'software', problem_id: 'unreliable-tools', effect: 'worsens',
    reason: 'Fowler warns that event replay can repeat updates to external systems. Assessment: replay can cause incorrect external state unless gateways suppress repeat updates. This cost depends on external effects and replay controls.',
    source: { title: 'Martin Fowler: event replay and external updates', url: 'https://martinfowler.com/eaaDev/EventSourcing.html' },
  },
  // Reason: the Microkernel trial found no reliability assessment and four problem gaps.
  {
    paradigm: 'Microkernel', layer: 'os', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'MINIX 3 isolates device drivers in separate user-mode processes and restricts their memory access. Assessment: this can contain driver memory faults. This does not prove whole-system reliability or apply to every microkernel.',
    source: { title: 'MINIX 3: driver isolation and memory access limits', url: 'https://wiki.minix3.org/doku.php?id=www:documentation:reliability' },
  },
  // Reason: the Embedded database trial found no assessment of deployment cost or fault isolation.
  {
    paradigm: 'Embedded database', layer: 'software', problem_id: 'deployment-complexity', effect: 'reduces',
    reason: 'SQLite needs no separate database server to install, configure or manage. Assessment: this removes database server setup from deployment. Other application deployment costs remain.',
    source: { title: 'SQLite: serverless benefits and costs', url: 'https://www.sqlite.org/serverless.html' },
  },
  {
    paradigm: 'Embedded database', layer: 'software', problem_id: 'unreliable-tools', effect: 'worsens',
    reason: 'SQLite shares the application process. A separate server can protect database memory from stray pointers in the client. Assessment: this removes one fault boundary. This does not prove more faults in every application.',
    source: { title: 'SQLite: serverless benefits and costs', url: 'https://www.sqlite.org/serverless.html' },
  },
  // Reason: the CQRS trial found no assessment of its cost for technical debt.
  {
    paradigm: 'CQRS', layer: 'software', problem_id: 'technical-debt', effect: 'worsens',
    reason: 'Fowler reports extra complexity, lower productivity and greater risk when CQRS does not fit the domain. Assessment: needless separate models can add technical debt. This does not apply to every CQRS use.',
    source: { title: 'Martin Fowler: CQRS suitability and complexity', url: 'https://martinfowler.com/bliki/CQRS.html' },
  },
  // Reason: the Ownership types trial found no reliability assessment.
  {
    paradigm: 'Ownership types', layer: 'language', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'In Rust, ownership checks reject use after a move and prevent double-free faults in the documented model. Assessment: this reduces memory-related unreliability. It does not prove whole-system reliability.',
    source: { title: 'Rust book: ownership and memory safety', url: 'https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html' },
  },
  // Reason: the Stack API reported no reduction for technical debt or unreliable systems.
  {
    paradigm: 'Dependency injection', layer: 'software', problem_id: 'technical-debt', effect: 'reduces',
    reason: 'Assessment: separate service configuration can reduce debt from concrete dependencies and duplicate selection logic. This does not address all technical debt.',
    source: { title: 'Martin Fowler: separate configuration from use', url: 'https://martinfowler.com/articles/injection.html#SeparatingConfigurationFromUse' },
  },
  {
    paradigm: 'Actor model', layer: 'language', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'In Erlang/OTP, supervisors restart failed child processes and limit repeated restarts. This can restore service after a process fault. Actors alone provide no supervisor.',
    source: { title: 'Erlang/OTP: supervision principles and restart limits', url: 'https://www.erlang.org/doc/system/sup_princ.html' },
  },
  {
    paradigm: 'Functional package management', layer: 'software', problem_id: 'build-complexity', effect: 'reduces',
    reason: 'Explicit dependencies and isolated package paths reduce hidden build dependencies in Nix.',
    source: { title: 'Nix manual: complete dependencies', url: 'https://nix.dev/manual/nix/2.34/introduction.html#complete-dependencies' },
  },
  {
    paradigm: 'Functional package management', layer: 'software', problem_id: 'deployment-complexity', effect: 'reduces',
    reason: 'Immutable package versions permit atomic upgrades and rollback in Nix. This reduces the risk from partial package updates.',
    source: { title: 'Nix manual: atomic upgrades and rollbacks', url: 'https://nix.dev/manual/nix/2.34/introduction.html#atomic-upgrades-and-rollbacks' },
  },
  // Reason: the Nix trial found no reliability assessment and two problem gaps.
  {
    paradigm: 'Functional package management', layer: 'software', problem_id: 'unreliable-tools', effect: 'reduces',
    reason: 'Nix documents atomic upgrades without a mix of old and new package files. Assessment: this can prevent crashes from partial package updates. Rollback requires retained versions. This does not prove application correctness or whole-system reliability or apply to every package manager.',
    source: { title: 'Nix manual: atomic upgrades and rollbacks', url: 'https://nix.dev/manual/nix/2.35/introduction.html#atomic-upgrades-and-rollbacks' },
  },
  {
    paradigm: 'Microservices', layer: 'software', problem_id: 'deployment-complexity', effect: 'worsens',
    reason: 'Compared with a monolith, more services add system complexity and require compatible service updates and mature operations.',
    source: { title: 'Azure Architecture Center: microservices challenges', url: 'https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/microservices#challenges' },
  },
];

function practicalProblems(paradigms) {
  const links = PROBLEM_LINKS.flatMap((link) => {
    const seed = START[link.layer].find((p) => p[0] === link.paradigm);
    return paradigms.filter((p) => p.layer === link.layer && p.name === seed[0] && p.url === seed[2])
      .map((p) => ({ ...link, paradigm_id: p.id }));
  });
  const withoutReduction = PRACTICAL_PROBLEMS.items.filter((p) => !links.some((l) => l.problem_id === p.id && l.effect === 'reduces'));
  return { ...PRACTICAL_PROBLEMS, links,
    coverage: {
      withoutReduction: withoutReduction.map((p) => p.id),
      unassessedParadigms: paradigms.length - new Set(links.map((l) => l.paradigm_id)).size,
      limit: 'Links are source-based assessments of specific mechanisms, not measured effects on survey shares. No link means no assessment, not no benefit.',
    } };
}

// Reason: the Stack trial had no measure of ideas that name a sourced practical problem.
function ideaProblems(ids) {
  const problems = PRACTICAL_PROBLEMS.items.filter((p) => Array.isArray(ids) && ids.includes(p.id));
  return { problem_ids: problems.map((p) => p.id), practical_problems: problems,
    problem_priority: Math.max(0, ...problems.map((p) => p.percent)) };
}

// Eigenvalues and eigenvectors of a symmetric matrix by cyclic Jacobi rotations.
// Returns pairs sorted by eigenvalue, largest first; each vector has its largest entry positive.
function eigen(m) {
  const n = m.length;
  const a = m.map((r) => [...r]);
  const v = a.map((_, i) => a.map((_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const kp = a[k][p], kq = a[k][q];
        a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq;
      }
      for (let k = 0; k < n; k++) {
        const pk = a[p][k], qk = a[q][k];
        a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk;
      }
      for (let k = 0; k < n; k++) {
        const kp = v[k][p], kq = v[k][q];
        v[k][p] = c * kp - s * kq; v[k][q] = s * kp + c * kq;
      }
    }
  }
  return a.map((_, i) => {
    const vec = v.map((r) => r[i]);
    const big = vec.reduce((b, x) => (Math.abs(x) > Math.abs(b) ? x : b), 0);
    return { value: a[i][i], vector: big < 0 ? vec.map((x) => -x) : vec };
  }).sort((x, y) => y.value - x.value);
}

// Principal component analysis of the rows (paradigms) over the columns (axes): centre each column,
// take the eigenvectors of the covariance, and project each row on the first two.
function pca(rows) {
  const n = rows.length, d = rows[0]?.length || 0;
  if (n < 3 || d < 2) return null;
  const mean = rows[0].map((_, j) => rows.reduce((s, r) => s + r[j], 0) / n);
  const x = rows.map((r) => r.map((v, j) => v - mean[j]));
  const cov = mean.map((_, i) => mean.map((_, j) => x.reduce((s, r) => s + r[i] * r[j], 0) / (n - 1)));
  const eig = eigen(cov);
  const total = eig.reduce((s, e) => s + Math.max(0, e.value), 0) || 1;
  const pcs = eig.slice(0, 2);
  return { mean, components: pcs.map((e) => e.vector), explained: pcs.map((e) => Math.max(0, e.value) / total),
    points: x.map((r) => pcs.map((e) => r.reduce((s, v, j) => s + v * e.vector[j], 0))) };
}

// The spread of the chosen paradigms on each axis. A large spread is a mismatch, a chance for a new idea.
function gaps(axes, scores, ids) {
  return axes.map((a) => {
    const vals = ids.map((id) => scores[id]?.[a.id]?.score).filter((v) => v !== undefined);
    const gap = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0;
    return { axis_id: a.id, name: a.name, gap, mismatch: gap >= MISMATCH };
  });
}

function stackData(db) {
  const axes = db.prepare(`SELECT * FROM axes ORDER BY id`).all();
  const paradigms = db.prepare(`SELECT * FROM paradigms ORDER BY layer, id`).all();
  const scores = {};
  for (const s of db.prepare(`SELECT * FROM scores`).all()) (scores[s.paradigm_id] ||= {})[s.axis_id] = s;
  const full = paradigms.filter((p) => axes.length && axes.every((a) => scores[p.id]?.[a.id]));
  const map = pca(full.map((p) => axes.map((a) => scores[p.id][a.id].score)));
  return { axes, paradigms, scores, practicalProblems: practicalProblems(paradigms),
    map: map && { ...map, ids: full.map((p) => p.id) } };
}

function stackView(cfg, pick) {
  const data = stackData(cfg.db);
  const ids = pick.filter((id) => data.paradigms.some((p) => p.id === id));
  return { ...data, layers: LAYERS, mismatch: MISMATCH, job: cfg.stackJob,
    // Reason: the Microservices trial showed only database coverage, with no selected-stack measure.
    selectedProblemCoverage: ids.length ? practicalProblems(data.paradigms.filter((p) => ids.includes(p.id))).coverage : null,
    gaps: ids.length > 1 ? gaps(data.axes, data.scores, ids) : [] };
}

// ---------- LLM ----------

// Runs `claude -p` with structured output. The prompt goes on stdin, so no text is read as an option.
function ask(cfg, prompt, schema, { web = false, model } = {}) {
  const tools = web ? 'WebSearch,WebFetch' : '';
  const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema),
    '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence',
    '--tools', tools, '--allowedTools', tools];
  if (model) args.push('--model', model);
  return new Promise((resolve, reject) => {
    const child = spawn(cfg.claude, args, { cwd: cfg.home, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), 15 * 60 * 1000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`cannot run ${cfg.claude}: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      let res;
      try { res = JSON.parse(out); } catch { return reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 400)}`)); }
      if (res.is_error || !res.structured_output) return reject(new Error(`claude: ${String(res.result || res.subtype).slice(0, 400)}`));
      resolve(res.structured_output);
    });
    child.stdin.end(prompt);
  });
}

const BOYD = `A Boydian snowmobile (John Boyd, "Destruction and Creation") is a new whole built from parts taken out of unrelated wholes: skis, an outboard motor, tank treads and bicycle handlebars make a snowmobile.`;

const str = { type: 'string' };
const int = { type: 'integer' };

const HUNT_SCHEMA = {
  type: 'object', required: ['sources'],
  properties: { sources: { type: 'array', items: {
    type: 'object', required: ['name', 'kind', 'url', 'summary', 'components'],
    properties: { name: str, kind: { enum: ['tool', 'paradigm'] }, url: str, summary: str,
      components: { type: 'array', items: { type: 'object', required: ['name', 'mechanism', 'url'],
        properties: { name: str, mechanism: str, url: str } } } } } } },
};

function huntPrompt(seed, bad) {
  return `${BOYD}

You hunt for parts. Seed (a pain, a domain, a tool or a paradigm): ${JSON.stringify(seed)}

Use web search and fetch to find 6 real, existing software tools or programming paradigms: 2 close to the seed and 4 from distant domains that could carry a useful part for it.
Break each one into its 3 to 5 principal components. A component is a mechanism that makes the whole work ("content-addressed objects named by their hash"), never a quality ("fast", "scalable") or a feature list.
Each source and each component has a URL that you found and that shows it: docs, source code, a paper or a talk. Do not invent tools or URLs.
${bad.length ? `These components killed earlier ideas. Do not use them again:\n${bad.map((c) => `- ${c.name}: ${c.bad_reason}`).join('\n')}\n` : ''}Keep each summary and each mechanism to one sentence.`;
}

const CREATE_SCHEMA = {
  type: 'object', required: ['candidates'],
  properties: { candidates: { type: 'array', items: {
    type: 'object', required: ['name', 'pitch', 'component_ids', 'problem', 'evidence_url', 'conventional',
      'gain_axis', 'gain', 'mismatch', 'verdict', 'proof_url', 'proof_note'],
    properties: { name: str, pitch: str, component_ids: { type: 'array', items: int },
      problem: str, evidence_url: str, conventional: str, gain_axis: str, gain: str, mismatch: str,
      verdict: { enum: ['survives', 'exists', 'no clear problem', 'no clear gain'] },
      proof_url: str, proof_note: str } } } },
};

// The case that each candidate must make before its creative description counts.
const PROBLEM = `For each candidate, also fill these 4 fields:
- problem: who has the problem, and what it is, in one sentence.
- evidence_url: a page that your web search found and that shows people have this problem: a forum thread, a review, an issue or an article. Never invent it.
- conventional: the solution that people use today, as a named product or method.
- gain_axis: the one axis on which this candidate does better (cost, speed, privacy, offline use, effort or similar), and gain: the mechanism by which it does better, with a claim that a test could prove false ("opens a 1 GB file in under 1 second on a 2020 phone, where X takes 30 seconds").
Then set verdict:
- "exists" if a product, project or paper already does the same thing with the same core mechanism: proof_url to it and proof_note to one sentence.
- "no clear problem" if you found no real source for the problem, and "no clear gain" if the candidate does not clearly beat the conventional solution on a named axis: proof_url "" and proof_note to one sentence why.
- "survives" otherwise: proof_url "" and proof_note to the closest thing you found and the difference.
Be strict and honest: a surviving candidate that already exists, or that solves no real problem better than today's solution, wastes the owner's time.`;

function createPrompt(seed, comps) {
  return `${BOYD}

Seed: ${JSON.stringify(seed)}
Parts (id, source, component, mechanism):
${comps.map((c) => `${c.id} | ${c.source} | ${c.name} | ${c.mechanism}`).join('\n')}

Combine parts from at least 2 different sources, the more distant the better, into 5 candidate snowmobiles: new software tools or techniques for the seed.
Each pitch is one concrete sentence: what a developer does with it and what the combination gives that no single source gives.
Search the web for the problem and for prior art for each candidate. Set mismatch to "".
${PROBLEM}`;
}

function stackCreatePrompt(seed, comps, data) {
  const { axes, scores } = data;
  // Reason: the brainstorm prompt omitted all five source assessments, which include a harmful effect.
  const available = new Set(comps.map((c) => c.paradigm_id));
  const assessments = data.practicalProblems.links.filter((l) => available.has(l.paradigm_id));
  const fixed = Object.keys(LAYERS).filter((l) => comps.filter((c) => c.source_kind === l).length === 1);
  const ids = comps.filter((c) => fixed.includes(c.source_kind)).map((c) => c.paradigm_id);
  const spread = ids.length > 1 ? gaps(axes, scores, ids) : [];
  return `A stack is one paradigm from each of 4 layers: ${Object.values(LAYERS).join(', ')}.
Where two layers of a stack disagree on a design axis, there is a mismatch: a chance for a product that no conventional stack makes possible, cheap or fast.

Seed (a practical problem, a stack, or both): ${JSON.stringify(seed)}
Design axes (id | name | 0 means | 10 means):
${axes.map((a) => `${a.id} | ${a.name} | ${a.low} | ${a.high}`).join('\n') || '(none yet)'}
Paradigms (id | layer | paradigm | summary | scores as axis id=score):
${comps.map((c) => `${c.id} | ${c.source_kind} | ${c.name} | ${c.mechanism} | ${axes.map((a) => `${a.id}=${scores[c.paradigm_id]?.[a.id]?.score ?? '?'}`).join(' ')}`).join('\n')}
${spread.length ? `Gaps of the fixed layers on each axis (max - min): ${spread.map((g) => `${g.name} ${g.gap}`).join(', ')}\n` : ''}
Propose 5 candidate consumer apps or developer tools. Give practical developer problems priority over novelty.
Set component_ids to exactly one paradigm id from each layer. A layer with only one paradigm above is fixed.
The stack is the unfair advantage: it makes the app possible, cheap or fast where a conventional stack cannot.
Each pitch states what a person does with the app or tool and what the stack gives.
Set mismatch to one sentence that names the 2 layers, their paradigms and the axis on which they disagree, and how the app uses that mismatch.
Practical problems (id | name | respondent share):
${PRACTICAL_PROBLEMS.items.map((p) => `${p.id} | ${p.name} | ${p.percent}%`).join('\n')}
Source: ${PRACTICAL_PROBLEMS.source.url}
${PRACTICAL_PROBLEMS.source.limit}
Problems without a documented paradigm reduction: ${data.practicalProblems.coverage.withoutReduction.join(', ')}.
Source assessments for available paradigms (JSON):
${JSON.stringify(assessments)}
Use these mechanisms and limits to assess each candidate. State how the chosen stack can reduce its named problems.
If a chosen paradigm can worsen a named problem, explain that cost in gain and compare it with the benefit.
A source assessment does not prove that a candidate works. No assessment means an unknown effect.
For each candidate, set problem_ids to the listed problems that it directly reduces. Use [] for no direct reduction.
Explain each claimed reduction in problem and gain. A survey link alone does not prove that the candidate helps.
Prefer a greater respondent share when evidence and gain are comparable. Do not add shares or equate prevalence with severity.
Search the web for the problem and for prior art for each candidate.
${PROBLEM}`;
}

// Reason: the Stack trial had no explicit problem links in generated ideas.
const STACK_CREATE_SCHEMA = {
  ...CREATE_SCHEMA,
  properties: { candidates: { ...CREATE_SCHEMA.properties.candidates, items: {
    ...CREATE_SCHEMA.properties.candidates.items,
    required: [...CREATE_SCHEMA.properties.candidates.items.required, 'problem_ids'],
    properties: { ...CREATE_SCHEMA.properties.candidates.items.properties,
      problem_ids: { type: 'array', items: { enum: PRACTICAL_PROBLEMS.items.map((p) => p.id) } } },
  } } },
};

const AXES_SCHEMA = {
  type: 'object', required: ['axes'],
  properties: { axes: { type: 'array', items: { type: 'object', required: ['name', 'low', 'high'],
    properties: { name: str, low: str, high: str } } } },
};

function axesPrompt(paradigms) {
  return `You design the axes of a map of computing paradigms in 4 layers: ${Object.values(LAYERS).join(', ')}.
Paradigms (layer | name | summary):
${paradigms.map((p) => `${p.layer} | ${p.name} | ${p.summary}`).join('\n')}

Propose 8 to 12 design axes that run through all 4 layers, so that a paradigm of each layer has a position on each axis. Examples: where state lives, when binding happens, who schedules, how parallelism is shown.
For each axis: a short name, what a score of 0 means (low) and what a score of 10 means (high), each in a few words.
Prefer axes that separate the paradigms well and that are not the same axis twice.`;
}

const SCORE_SCHEMA = {
  type: 'object', required: ['scores'],
  properties: { scores: { type: 'array', items: { type: 'object', required: ['paradigm_id', 'axis_id', 'score', 'reason'],
    properties: { paradigm_id: int, axis_id: int, score: int, reason: str } } } },
};

function scorePrompt(axes, paradigms) {
  return `Score each paradigm on each design axis, from 0 to 10, with a one-line reason.
Axes (id | name | 0 means | 10 means):
${axes.map((a) => `${a.id} | ${a.name} | ${a.low} | ${a.high}`).join('\n')}
Paradigms (id | layer | name | summary):
${paradigms.map((p) => `${p.id} | ${p.layer} | ${p.name} | ${p.summary}`).join('\n')}

Return one score for each pair of paradigm and axis. Use the whole range, so that the paradigms spread out.`;
}

const PARADIGM_SCHEMA = {
  type: 'object', required: ['paradigms'],
  properties: { paradigms: { type: 'array', items: { type: 'object', required: ['layer', 'name', 'summary', 'url'],
    properties: { layer: { enum: Object.keys(LAYERS) }, name: str, summary: str, url: str } } } },
};

function paradigmPrompt(paradigms) {
  return `You hunt for paradigms in 4 layers of a computing stack: ${Object.entries(LAYERS).map(([k, v]) => `${k} (${v})`).join(', ')}.
The map has these already:
${paradigms.map((p) => `${p.layer} | ${p.name}`).join('\n')}

Use web search and fetch to find 8 more real paradigms, 2 in each layer.
Search research, history and niche practice for mechanisms that reduce practical problems.
Each paradigm needs a URL that you opened: documentation, a paper or a talk.
Do not invent paradigms or URLs.

Practical problems and source assessments (JSON):
${JSON.stringify(practicalProblems(paradigms))}
Prefer evidence of practical benefit over map distance.
Order candidates by the greatest respondent share of a problem they can reduce, when evidence and benefit are comparable.
Do not add shares or equate prevalence with severity.
For comparable priorities, prefer problems without a documented reduction, then mechanisms absent from the map.
Use source links to explain each benefit, harm and limit in the summary.
Name the problem that each mechanism can reduce, or state that its effect is unknown.
An absent assessment does not prove an absent benefit. A survey source alone does not prove a paradigm's benefit.`;
}

const POINT_SCHEMA = {
  type: 'object', required: ['layer', 'name', 'exists', 'url', 'why'],
  properties: { layer: { enum: Object.keys(LAYERS) }, name: str, exists: { type: 'boolean' }, url: str, why: str },
};

function pointPrompt(axes, profile, near, problems) {
  return `A map of computing paradigms in 4 layers (${Object.values(LAYERS).join(', ')}) has an empty point with this profile (axis: score out of 10, where 0 and 10 mean):
${axes.map((a, i) => `${a.name}: ${profile[i]} (0 = ${a.low}, 10 = ${a.high})`).join('\n')}
The nearest paradigms on the map: ${near.map((p) => `${p.name} (${p.layer})`).join(', ')}.

Practical problems and source assessments (JSON):
${JSON.stringify(problems)}

Which paradigm would live at this point?
Use web search and fetch to find a real paradigm that fits the profile.
Each real paradigm needs a URL that you opened. Do not invent paradigms or URLs.
If no real paradigm fits, set exists false, name "No verified match", and url "".
Otherwise, set exists true and give the real name and URL.
Among comparable fits, prefer evidence of practical benefit over map distance.
When evidence and benefit are comparable, use the greatest respondent share of a problem the paradigm can reduce.
Do not add shares or equate prevalence with severity.
In why, explain the profile fit and the difference from nearby paradigms.
In why, name the practical problem and source links for the benefit, harm and limits.
State unknown effects.
A survey source alone does not prove a paradigm's benefit. No assessment means an unknown effect.`;
}

const GRILL_SCHEMA = {
  type: 'object', required: ['verdict', 'decisions', 'brief', 'killed_component_id', 'reason'],
  properties: {
    verdict: { enum: ['open', 'done', 'killed'] },
    decisions: { type: 'array', items: {
      type: 'object', required: ['id', 'question', 'depends_on', 'options', 'recommended'],
      properties: { id: str, question: str, depends_on: { type: 'array', items: str },
        recommended: int,
        options: { type: 'array', items: { type: 'object', required: ['label', 'why', 'kills_component_id'],
          properties: { label: str, why: str, kills_component_id: int } } } } } },
    brief: str, killed_component_id: int, reason: str,
  },
};

function grillPrompt(sm, comps, decisions) {
  const settled = decisions.map((d) => {
    const a = d.answer;
    const choice = a.choice >= 0 ? d.options[a.choice].label : '(no option)';
    return `- ${d.id}: ${d.question}\n  answer: ${choice}${a.note ? `\n  note from the owner: ${a.note}` : ''}`;
  }).join('\n');
  return `You run Matt Pocock's "grill me" on a plan: walk the design tree, one round at a time, until no decision is open.

Plan: ${sm.name}. ${sm.pitch}
${sm.problem ? `Problem: ${sm.problem}\nConventional solution: ${sm.conventional}\nClaimed gain (${sm.gain_axis}): ${sm.gain}\n` : ''}Parts (id | component | mechanism):
${comps.map((c) => `${c.id} | ${c.name} | ${c.mechanism}`).join('\n')}

Settled decisions:
${settled || '(none yet)'}

Return the next round: every open decision whose prerequisites are all settled, not only one. At most 6. Ask only decisions that change what gets built.
${settled ? '' : 'This is the first round. It must include a decision that tests why the plan beats the conventional solution on its claimed gain: an option under which the gain fails makes the plan pointless.\n'}
For each decision: a new short id (lowercase-with-dashes, not used above), the question, depends_on (ids of the settled decisions it builds on), 2 to 4 options with a short label and a one-sentence why, and the index of the option you recommend.
For an option that makes the whole plan pointless because one part fails, set kills_component_id to that part's id. Otherwise set it to 0. Never recommend such an option.
If a settled answer or note already makes the plan pointless, set verdict "killed", decisions [], killed_component_id to the part to blame and reason to one sentence.
If no decision is open, set verdict "done", decisions [] and brief to a build brief in Markdown: what to build, the settled decisions, the first three steps and the main risk.
Otherwise set verdict "open". Set unused fields to "" or 0. Aim for done in 3 to 5 rounds.`;
}

// ---------- jobs ----------

function partsOf(db, ids) {
  if (!ids.length) return [];
  return db.prepare(`SELECT c.*, s.name AS source FROM components c JOIN sources s ON s.id = c.source_id
    WHERE c.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
}

async function runHunt(cfg, huntId) {
  const { db } = cfg;
  const hunt = db.prepare(`SELECT * FROM hunts WHERE id = ?`).get(huntId);
  try {
    if (hunt.stack) throw new Error('a stack hunt takes its parts from the stack map');
    const bad = db.prepare(`SELECT name, bad_reason FROM components WHERE bad_reason IS NOT NULL`).all();
    const out = await ask(cfg, huntPrompt(hunt.seed, bad), HUNT_SCHEMA, { web: true });
    const addSource = db.prepare(`INSERT INTO sources (hunt_id, name, kind, url, summary) VALUES (?, ?, ?, ?, ?)`);
    const addComp = db.prepare(`INSERT INTO components (source_id, name, mechanism, url) VALUES (?, ?, ?, ?)`);
    for (const s of out.sources) {
      const sid = addSource.run(huntId, s.name, s.kind, s.url, s.summary).lastInsertRowid;
      for (const c of s.components) addComp.run(sid, c.name, c.mechanism, c.url);
    }
    db.prepare(`UPDATE hunts SET status = 'hunted', error = NULL WHERE id = ?`).run(huntId);
  } catch (e) {
    db.prepare(`UPDATE hunts SET status = 'failed', error = ? WHERE id = ?`).run(e.message, huntId);
  }
}

// A candidate without a real problem or a clear gain goes to the graveyard, the same way as prior art.
function graveOf(c) {
  if (c.verdict === 'exists') return 'exists';
  const blank = (k) => !String(c[k] || '').trim();
  if (c.verdict === 'no clear problem' || blank('problem') || !/^https?:\/\//i.test(c.evidence_url || '')) return 'no clear problem';
  if (c.verdict === 'no clear gain' || blank('conventional') || blank('gain_axis') || blank('gain')) return 'no clear gain';
  return null;
}

async function runCreate(cfg, huntId) {
  const { db } = cfg;
  const hunt = db.prepare(`SELECT * FROM hunts WHERE id = ?`).get(huntId);
  try {
    const comps = db.prepare(`SELECT c.*, s.name AS source, s.kind AS source_kind FROM components c JOIN sources s ON s.id = c.source_id
      WHERE s.hunt_id = ? AND c.bad_reason IS NULL`).all(huntId);
    const prompt = hunt.stack ? stackCreatePrompt(hunt.seed, comps, stackData(db)) : createPrompt(hunt.seed, comps);
    const out = await ask(cfg, prompt, hunt.stack ? STACK_CREATE_SCHEMA : CREATE_SCHEMA, { web: true });
    const known = new Set(comps.map((c) => c.id));
    const add = db.prepare(`INSERT INTO snowmobiles (hunt_id, name, pitch, component_ids, status, proof_url, proof_note,
      problem, evidence_url, conventional, gain_axis, gain, mismatch, problem_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const c of out.candidates) {
      const ids = c.component_ids.filter((i) => known.has(i));
      const grave = graveOf(c);
      const proofUrl = grave === 'exists' ? c.proof_url : '';
      const note = grave && grave !== 'exists' ? `${grave[0].toUpperCase()}${grave.slice(1)}: ${c.proof_note}` : c.proof_note;
      add.run(huntId, c.name, c.pitch, JSON.stringify(ids), grave ? 'graveyard' : 'survivor', proofUrl, note,
        c.problem, c.evidence_url, c.conventional, c.gain_axis, c.gain, hunt.stack ? c.mismatch : null,
        hunt.stack ? JSON.stringify(ideaProblems(c.problem_ids).problem_ids) : null);
    }
    db.prepare(`UPDATE hunts SET status = 'created', error = NULL WHERE id = ?`).run(huntId);
  } catch (e) {
    db.prepare(`UPDATE hunts SET status = 'failed', error = ? WHERE id = ?`).run(e.message, huntId);
  }
}

// A stack hunt takes its parts from the map: the chosen paradigm of each layer, or each paradigm
// of a layer with no choice. Each paradigm is a source with one component, so a kill marks it.
function plantStack(db, huntId, pick) {
  const chosen = db.prepare(`SELECT * FROM paradigms`).all();
  const addSource = db.prepare(`INSERT INTO sources (hunt_id, name, kind, url, summary) VALUES (?, ?, ?, ?, ?)`);
  const addComp = db.prepare(`INSERT INTO components (source_id, name, mechanism, url, paradigm_id) VALUES (?, ?, ?, ?, ?)`);
  for (const layer of Object.keys(LAYERS)) {
    const own = chosen.filter((p) => p.layer === layer);
    for (const p of own.some((q) => pick.includes(q.id)) ? own.filter((q) => pick.includes(q.id)) : own) {
      const sid = addSource.run(huntId, p.name, layer, p.url, p.summary).lastInsertRowid;
      addComp.run(sid, p.name, p.summary, p.url, p.id);
    }
  }
}

// The map jobs: propose the axes once, score each paradigm that misses a score, and hunt for more paradigms.
// One job at a time. A restart forgets a running job, and nothing waits for it.
async function scoreMissing(cfg) {
  const { db } = cfg;
  const axes = db.prepare(`SELECT * FROM axes ORDER BY id`).all();
  if (!axes.length) return;
  const missing = db.prepare(`SELECT * FROM paradigms p WHERE (SELECT COUNT(*) FROM scores s WHERE s.paradigm_id = p.id) < ?`)
    .all(axes.length);
  if (!missing.length) return;
  cfg.stackJob = { step: 'scoring' };
  const out = await ask(cfg, scorePrompt(axes, missing), SCORE_SCHEMA);
  const pids = new Set(missing.map((p) => p.id)), aids = new Set(axes.map((a) => a.id));
  // An owner's edit is never overwritten.
  const add = db.prepare(`INSERT OR IGNORE INTO scores (paradigm_id, axis_id, score, reason) VALUES (?, ?, ?, ?)`);
  for (const s of out.scores) {
    if (pids.has(s.paradigm_id) && aids.has(s.axis_id)) add.run(s.paradigm_id, s.axis_id, Math.min(10, Math.max(0, s.score)), s.reason);
  }
}

async function runStackJob(cfg, step) {
  const { db } = cfg;
  cfg.stackJob = { step };
  try {
    if (step === 'axes' && !db.prepare(`SELECT 1 FROM axes LIMIT 1`).get()) {
      const out = await ask(cfg, axesPrompt(db.prepare(`SELECT * FROM paradigms`).all()), AXES_SCHEMA);
      const add = db.prepare(`INSERT INTO axes (name, low, high) VALUES (?, ?, ?)`);
      for (const a of out.axes.slice(0, 12)) add.run(a.name, a.low, a.high);
    }
    if (step === 'hunting') {
      const have = db.prepare(`SELECT * FROM paradigms`).all();
      const out = await ask(cfg, paradigmPrompt(have), PARADIGM_SCHEMA, { web: true });
      const names = new Set(have.map((p) => p.name.toLowerCase()));
      const add = db.prepare(`INSERT INTO paradigms (layer, name, summary, url) VALUES (?, ?, ?, ?)`);
      for (const p of out.paradigms) {
        if (LAYERS[p.layer] && !names.has(p.name.toLowerCase())) { names.add(p.name.toLowerCase()); add.run(p.layer, p.name, p.summary, p.url); }
      }
    }
    await scoreMissing(cfg);
    cfg.stackJob = null;
  } catch (e) {
    cfg.stackJob = { step, error: e.message };
  }
}

// Asks which paradigm would live at an empty point of the map. The point maps back to a profile
// on the axes: the mean plus x times the first component plus y times the second.
async function askPoint(cfg, x, y) {
  const data = stackData(cfg.db);
  const { map, axes } = data;
  if (!map) throw new Error('the map needs axes and scores first');
  const profile = map.mean.map((m, j) => Math.round(10 * Math.min(10, Math.max(0, m + x * map.components[0][j] + y * map.components[1][j]))) / 10);
  const near = map.ids.map((id, i) => ({ id, d: Math.hypot(map.points[i][0] - x, map.points[i][1] - y) }))
    .sort((a, b) => a.d - b.d).slice(0, 3).map((n) => data.paradigms.find((p) => p.id === n.id));
  const answer = await ask(cfg, pointPrompt(axes, profile, near, data.practicalProblems), POINT_SCHEMA);
  return { x, y, profile, answer };
}

// The lines that each build brief starts with: the case for the idea, and for a stack the mismatch that it uses.
function briefHead(sm) {
  if (!sm.problem) return '';
  return [`**Problem:** ${sm.problem}`, `**Evidence:** ${sm.evidence_url}`, `**Conventional solution:** ${sm.conventional}`,
    `**Why better (${sm.gain_axis}):** ${sm.gain}`, ...(sm.mismatch ? [`**Layer mismatch:** ${sm.mismatch}`] : [])].join('\n') + '\n\n';
}

// The frontier for a set of settled answers. Calls are cached by that set, so the round that
// follows the recommended answers is computed while the owner still reads the current one.

function frontierKey(smId, settled) {
  return `${smId}:${JSON.stringify(settled.map((d) => [d.id, d.answer]))}`;
}

function frontier(cfg, sm, settled) {
  const { frontiers } = cfg;
  const key = frontierKey(sm.id, settled);
  if (!frontiers.has(key)) {
    const comps = partsOf(cfg.db, JSON.parse(sm.component_ids));
    const p = ask(cfg, grillPrompt(sm, comps, settled), GRILL_SCHEMA, { model: cfg.grillModel });
    p.catch(() => frontiers.delete(key));
    frontiers.set(key, p);
  }
  return frontiers.get(key);
}

function settledOf(tree) {
  return tree.decisions.filter((d) => d.answer);
}

// Asks for the round after the current tree, writes it into the tree, then speculates on the next.
async function advance(cfg, smId) {
  const { db, grillErrors } = cfg;
  const sm = db.prepare(`SELECT * FROM snowmobiles WHERE id = ?`).get(smId);
  const grill = db.prepare(`SELECT * FROM grills WHERE snowmobile_id = ?`).get(smId);
  const tree = JSON.parse(grill.tree);
  const settled = settledOf(tree);
  grillErrors.delete(smId);
  let out;
  try { out = await frontier(cfg, sm, settled); } catch (e) { grillErrors.set(smId, e.message); return; }
  // The owner may have answered differently while this call ran.
  const now = JSON.parse(db.prepare(`SELECT tree FROM grills WHERE snowmobile_id = ?`).get(smId).tree);
  if (frontierKey(smId, settledOf(now)) !== frontierKey(smId, settled) || now.decisions.some((d) => !d.answer)) return;
  if (out.verdict === 'killed') return kill(cfg, sm, out.killed_component_id, out.reason, now);
  if (out.verdict === 'done' || !out.decisions.length) {
    now.round += 1;
    db.prepare(`UPDATE grills SET tree = ?, status = 'done', brief = ?, updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`)
      .run(JSON.stringify(now), briefHead(sm) + out.brief, smId);
    db.prepare(`UPDATE snowmobiles SET status = 'grilled' WHERE id = ?`).run(smId);
    return;
  }
  now.round += 1;
  const used = new Set(now.decisions.map((d) => d.id));
  const parts = JSON.parse(sm.component_ids);
  for (const d of out.decisions) {
    for (const o of d.options) if (!parts.includes(o.kills_component_id)) o.kills_component_id = 0;
    let id = d.id;
    while (used.has(id)) id += '-';
    used.add(id);
    const rec = d.options[d.recommended] && !d.options[d.recommended].kills_component_id ? d.recommended
      : Math.max(0, d.options.findIndex((o) => !o.kills_component_id));
    now.decisions.push({ ...d, id, recommended: rec, round: now.round, answer: null });
  }
  db.prepare(`UPDATE grills SET tree = ?, updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`).run(JSON.stringify(now), smId);
  // Speculate: the next round after the recommended answers.
  const guess = now.decisions.map((d) => (d.answer ? d : { ...d, answer: { choice: d.recommended, note: '' } }));
  frontier(cfg, sm, guess).catch(() => {});
}

// The saved kill of a grill that still stands on the part with this mark.
function standingKill(db, componentId, mark) {
  const g = db.prepare(`SELECT g.tree FROM grills g JOIN snowmobiles s ON s.id = g.snowmobile_id
    WHERE g.status = 'killed' AND json_extract(g.tree, '$.killed.component_id') = ?
    AND s.name || ': ' || json_extract(g.tree, '$.killed.reason') = ?`).get(componentId, mark);
  return g && JSON.parse(g.tree).killed;
}

function kill(cfg, sm, componentId, reason, tree) {
  const { db } = cfg;
  if (!JSON.parse(sm.component_ids).includes(componentId)) componentId = 0;
  let under = [], badReason = null;
  if (componentId) {
    const now = db.prepare(`SELECT bad_reason FROM components WHERE id = ?`).get(componentId).bad_reason;
    const below = now && standingKill(db, componentId, now);
    if (below) [under, badReason] = [[...(below.under || []), now], below.bad_reason];
    else badReason = now;
    db.prepare(`UPDATE components SET bad_reason = ? WHERE id = ?`).run(`${sm.name}: ${reason}`, componentId);
  }
  db.prepare(`UPDATE snowmobiles SET status = 'killed', proof_note = ? WHERE id = ?`).run(reason, sm.id);
  // The note that the kill replaces, the marks of the kills under it, and your own mark under them, so that an undo can put them back.
  tree.killed = { component_id: componentId, reason, note: sm.proof_note, bad_reason: badReason, under };
  db.prepare(`UPDATE grills SET tree = ?, status = 'killed', updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`)
    .run(JSON.stringify(tree), sm.id);
}

// Takes back the last answered round: its answers, the rounds after it, and a kill or a brief that it caused.
function undoRound(cfg, smId) {
  const { db } = cfg;
  const sm = db.prepare(`SELECT * FROM snowmobiles WHERE id = ?`).get(smId);
  const grill = db.prepare(`SELECT * FROM grills WHERE snowmobile_id = ?`).get(smId);
  const tree = JSON.parse(grill.tree);
  const last = Math.max(0, ...settledOf(tree).map((d) => d.round));
  if (!last) return false;
  tree.decisions = tree.decisions.filter((d) => d.round <= last);
  for (const d of tree.decisions) if (d.round === last) d.answer = null;
  tree.round = last;
  let note = sm.proof_note;
  if (tree.killed) {
    const { component_id: cid, reason } = tree.killed;
    // The part gets the mark of the most recent kill under this one that still stands, else your own mark.
    if (cid && db.prepare(`SELECT bad_reason FROM components WHERE id = ?`).get(cid).bad_reason === `${sm.name}: ${reason}`) {
      const back = (tree.killed.under || []).findLast((m) => standingKill(db, cid, m));
      db.prepare(`UPDATE components SET bad_reason = ? WHERE id = ?`)
        .run(back || (tree.killed.bad_reason === LEFT_OUT ? LEFT_OUT : null), cid);
    }
    note = tree.killed.note ?? note;
    delete tree.killed;
  }
  db.prepare(`UPDATE snowmobiles SET status = 'survivor', proof_note = ? WHERE id = ? AND status IN ('killed', 'grilled')`).run(note, smId);
  db.prepare(`UPDATE grills SET tree = ?, status = 'open', brief = NULL, updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`)
    .run(JSON.stringify(tree), smId);
  cfg.grillErrors.delete(smId);
  return true;
}

// ---------- HTTP ----------

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
}

function huntView(db, id) {
  const hunt = db.prepare(`SELECT * FROM hunts WHERE id = ?`).get(id);
  if (!hunt) return null;
  const sources = db.prepare(`SELECT * FROM sources WHERE hunt_id = ?`).all(id);
  for (const s of sources) s.components = db.prepare(`SELECT * FROM components WHERE source_id = ?`).all(s.id);
  const snowmobiles = db.prepare(`SELECT * FROM snowmobiles WHERE hunt_id = ? ORDER BY id`).all(id)
    .map((s) => ({ ...s, component_ids: JSON.parse(s.component_ids), ...ideaProblems(JSON.parse(s.problem_ids || 'null')) }));
  if (hunt.stack) snowmobiles.sort((a, b) => b.problem_priority - a.problem_priority);
  const assessed = snowmobiles.filter((s) => s.problem_ids.length).length;
  return { hunt, sources, snowmobiles, problemCoverage: hunt.stack ? {
    total: snowmobiles.length, named: assessed, share: snowmobiles.length ? assessed / snowmobiles.length : null,
    source: PRACTICAL_PROBLEMS.source,
    limit: 'Counts include all candidates, also the graveyard. Links are model claims, not proof of a reduction.',
  } : null };
}

function grillView(cfg, smId) {
  const { db, grillErrors } = cfg;
  const sm = db.prepare(`SELECT * FROM snowmobiles WHERE id = ?`).get(smId);
  if (!sm) return null;
  const grill = db.prepare(`SELECT * FROM grills WHERE snowmobile_id = ?`).get(smId);
  const tree = JSON.parse(grill.tree);
  const pending = grill.status === 'open' && !tree.decisions.some((d) => !d.answer);
  return { snowmobile: { ...sm, component_ids: JSON.parse(sm.component_ids) },
    components: partsOf(db, JSON.parse(sm.component_ids)), tree, status: grill.status, brief: grill.brief,
    pending: pending && !grillErrors.has(smId), error: grillErrors.get(smId) || null };
}

function search(db, q) {
  const like = `%${q}%`;
  return {
    hunts: db.prepare(`SELECT * FROM hunts WHERE seed LIKE ? ORDER BY id DESC LIMIT 100`).all(like),
    snowmobiles: db.prepare(`SELECT s.*, h.seed FROM snowmobiles s JOIN hunts h ON h.id = s.hunt_id
      LEFT JOIN grills g ON g.snowmobile_id = s.id
      WHERE s.name LIKE ? OR s.pitch LIKE ? OR s.proof_note LIKE ? OR g.brief LIKE ? OR g.tree LIKE ?
      ORDER BY s.id DESC LIMIT 200`).all(like, like, like, like, like),
    components: db.prepare(`SELECT c.*, s.name AS source, s.hunt_id FROM components c JOIN sources s ON s.id = c.source_id
      WHERE c.name LIKE ? OR c.mechanism LIKE ? OR s.name LIKE ? ORDER BY c.id DESC LIMIT 200`).all(like, like, like),
  };
}

// The marks that the owner's own actions leave on a part and on an idea.
const LEFT_OUT = 'left out by you';
const BURIED = 'Buried by you. ';

function handler(cfg) {
  const { db } = cfg;
  const page = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  return async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const t = Buffer.from(String(url.searchParams.get('token') || req.headers['x-token'] || ''));
    const want = Buffer.from(cfg.token);
    if (t.length !== want.length || !crypto.timingSafeEqual(t, want)) {
      return send(res, 403, 'Open the URL that snowmobile printed at start, with its token.\n', 'text/plain');
    }
    const p = url.pathname;
    const m = (re) => p.match(re);
    let r;
    try {
      if (req.method === 'GET' && p === '/') {
        return send(res, 200, page, 'text/html; charset=utf-8');
      }
      if (req.method === 'POST' && p === '/api/hunts') {
        const { seed, stack } = await readBody(req);
        if (Array.isArray(stack)) {
          // Stack mode: a consumer pain, a stack (at most one paradigm per layer), or both.
          const ps = stack.map((id) => db.prepare(`SELECT * FROM paradigms WHERE id = ?`).get(id));
          if (ps.some((x) => !x)) return send(res, 400, { error: 'no such paradigm' });
          if (new Set(ps.map((x) => x.layer)).size !== ps.length) return send(res, 400, { error: 'pick one paradigm per layer' });
          const text = [String(seed || '').trim(), ps.map((x) => x.name).join(' + ')].filter(Boolean).join(' · ');
          if (!text) return send(res, 400, { error: 'seed is empty: write a pain or pick a stack' });
          const id = db.prepare(`INSERT INTO hunts (seed, status, stack) VALUES (?, 'creating', ?)`)
            .run(text, JSON.stringify(ps.map((x) => x.id))).lastInsertRowid;
          plantStack(db, id, ps.map((x) => x.id));
          runCreate(cfg, id);
          return send(res, 200, { id });
        }
        if (!seed || !String(seed).trim()) return send(res, 400, { error: 'seed is empty' });
        const id = db.prepare(`INSERT INTO hunts (seed, status) VALUES (?, 'hunting')`).run(String(seed).trim()).lastInsertRowid;
        runHunt(cfg, id);
        return send(res, 200, { id });
      }
      if (req.method === 'GET' && p === '/api/stack') {
        const pick = (url.searchParams.get('pick') || '').split(',').filter(Boolean).map(Number);
        return send(res, 200, stackView(cfg, pick));
      }
      if (req.method === 'POST' && (r = m(/^\/api\/stack\/(axes|hunting)$/))) {
        if (cfg.stackJob && !cfg.stackJob.error) return send(res, 409, { error: 'a step already runs' });
        runStackJob(cfg, r[1]);
        return send(res, 200, {});
      }
      if (req.method === 'POST' && p === '/api/stack/point') {
        const { x, y } = await readBody(req);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return send(res, 400, { error: 'x and y are numbers' });
        return send(res, 200, await askPoint(cfg, x, y));
      }
      if (req.method === 'POST' && (r = m(/^\/api\/axes\/(\d+)$/))) {
        const { name, low, high } = await readBody(req);
        if (!name || !String(name).trim()) return send(res, 400, { error: 'name is empty' });
        const ok = db.prepare(`UPDATE axes SET name = ?, low = ?, high = ? WHERE id = ?`)
          .run(String(name).trim(), String(low || ''), String(high || ''), Number(r[1])).changes;
        return ok ? send(res, 200, {}) : send(res, 404, { error: 'no such axis' });
      }
      if (req.method === 'POST' && p === '/api/scores') {
        const { paradigm_id, axis_id, score, reason } = await readBody(req);
        if (!Number.isInteger(score) || score < 0 || score > 10) return send(res, 400, { error: 'score is an integer from 0 to 10' });
        if (!db.prepare(`SELECT 1 FROM paradigms WHERE id = ?`).get(paradigm_id) || !db.prepare(`SELECT 1 FROM axes WHERE id = ?`).get(axis_id)) {
          return send(res, 404, { error: 'no such paradigm or axis' });
        }
        db.prepare(`INSERT INTO scores (paradigm_id, axis_id, score, reason) VALUES (?, ?, ?, ?)
          ON CONFLICT (paradigm_id, axis_id) DO UPDATE SET score = excluded.score, reason = excluded.reason`)
          .run(paradigm_id, axis_id, score, String(reason || 'set by the owner'));
        return send(res, 200, {});
      }
      if (req.method === 'POST' && (r = m(/^\/api\/components\/(\d+)$/))) {
        // The owner leaves a part out of the next creation, or brings it back.
        const { out } = await readBody(req);
        const ok = db.prepare(`UPDATE components SET bad_reason = ? WHERE id = ?`).run(out ? LEFT_OUT : null, Number(r[1])).changes;
        return ok ? send(res, 200, {}) : send(res, 404, { error: 'no such part' });
      }
      if (req.method === 'POST' && (r = m(/^\/api\/snowmobiles\/(\d+)$/))) {
        // The owner buries a survivor, or restores an idea from the graveyard. An undo sends the earlier note.
        const { status, proof_note } = await readBody(req);
        const sm = db.prepare(`SELECT * FROM snowmobiles WHERE id = ?`).get(Number(r[1]));
        if (!sm) return send(res, 404, { error: 'no such idea' });
        const from = { graveyard: 'survivor', survivor: 'graveyard' }[status];
        if (!from || sm.status !== from) return send(res, 409, { error: `only a ${from || 'survivor'} can become ${status}` });
        const note = proof_note !== undefined ? proof_note === null ? null : String(proof_note) : status === 'graveyard' ? BURIED + (sm.proof_note || '') : String(sm.proof_note || '').replace(BURIED, '');
        db.prepare(`UPDATE snowmobiles SET status = ?, proof_note = ? WHERE id = ?`).run(status, note, sm.id);
        return send(res, 200, {});
      }
      if (req.method === 'GET' && (r = m(/^\/api\/hunts\/(\d+)$/))) {
        const v = huntView(db, Number(r[1]));
        return v ? send(res, 200, v) : send(res, 404, { error: 'no such hunt' });
      }
      if (req.method === 'POST' && (r = m(/^\/api\/hunts\/(\d+)\/(hunt|create)$/))) {
        const id = Number(r[1]);
        const hunt = db.prepare(`SELECT * FROM hunts WHERE id = ?`).get(id);
        if (!hunt) return send(res, 404, { error: 'no such hunt' });
        if (hunt.status === 'hunting' || hunt.status === 'creating') return send(res, 409, { error: 'a step already runs' });
        const hunting = r[2] === 'hunt';
        db.prepare(`UPDATE hunts SET status = ?, error = NULL WHERE id = ?`).run(hunting ? 'hunting' : 'creating', id);
        (hunting ? runHunt : runCreate)(cfg, id);
        return send(res, 200, { id });
      }
      if (req.method === 'GET' && (r = m(/^\/api\/grills\/(\d+)$/))) {
        const smId = Number(r[1]);
        if (!db.prepare(`SELECT 1 FROM snowmobiles WHERE id = ?`).get(smId)) return send(res, 404, { error: 'no such snowmobile' });
        if (!db.prepare(`SELECT 1 FROM grills WHERE snowmobile_id = ?`).get(smId)) {
          db.prepare(`INSERT INTO grills (snowmobile_id, tree, status) VALUES (?, ?, 'open')`)
            .run(smId, JSON.stringify({ round: 0, decisions: [] }));
        }
        // A grill that waits for a round that no call computes (a new grill, or a restart mid-call).
        const grill = db.prepare(`SELECT * FROM grills WHERE snowmobile_id = ?`).get(smId);
        const tree = JSON.parse(grill.tree);
        if (grill.status === 'open' && tree.decisions.every((d) => d.answer)
          && !cfg.frontiers.has(frontierKey(smId, settledOf(tree))) && !cfg.grillErrors.has(smId)) advance(cfg, smId);
        return send(res, 200, grillView(cfg, smId));
      }
      if (req.method === 'POST' && (r = m(/^\/api\/grills\/(\d+)\/undo$/))) {
        const smId = Number(r[1]);
        if (!db.prepare(`SELECT 1 FROM grills WHERE snowmobile_id = ?`).get(smId)) return send(res, 404, { error: 'no such grill' });
        if (!undoRound(cfg, smId)) return send(res, 409, { error: 'no round to undo' });
        return send(res, 200, grillView(cfg, smId));
      }
      if (req.method === 'POST' && (r = m(/^\/api\/grills\/(\d+)\/(answer|retry)$/))) {
        const smId = Number(r[1]);
        const grill = db.prepare(`SELECT * FROM grills WHERE snowmobile_id = ?`).get(smId);
        if (!grill || grill.status !== 'open') return send(res, 409, { error: 'this grill is not open' });
        const tree = JSON.parse(grill.tree);
        if (r[2] === 'answer') {
          const { answers } = await readBody(req);
          const open = tree.decisions.filter((d) => !d.answer);
          for (const d of open) {
            const a = answers && answers[d.id];
            if (!a || !Number.isInteger(a.choice) || a.choice < -1 || a.choice >= d.options.length) {
              return send(res, 400, { error: `no answer for ${d.id}` });
            }
            d.answer = { choice: a.choice, note: String(a.note || '').trim().slice(0, 2000) };
          }
          const killer = open.find((d) => d.answer.choice >= 0 && d.options[d.answer.choice].kills_component_id);
          if (killer) {
            const sm = db.prepare(`SELECT * FROM snowmobiles WHERE id = ?`).get(smId);
            const opt = killer.options[killer.answer.choice];
            kill(cfg, sm, opt.kills_component_id, `${killer.question} ${opt.label}: ${opt.why}`, tree);
            return send(res, 200, grillView(cfg, smId));
          }
          db.prepare(`UPDATE grills SET tree = ?, updated_at = CURRENT_TIMESTAMP WHERE snowmobile_id = ?`).run(JSON.stringify(tree), smId);
        }
        advance(cfg, smId);
        return send(res, 200, grillView(cfg, smId));
      }
      if (req.method === 'GET' && p === '/api/search') {
        return send(res, 200, search(db, url.searchParams.get('q') || ''));
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  };
}

function start({ home = path.join(os.homedir(), '.snowmobile'), port = 4747, claude = 'claude',
  grillModel = 'sonnet' } = {}) {
  const db = openDb(path.join(home, 'snowmobile.db'));
  const cfg = { db, home, claude, grillModel, token: token(db), frontiers: new Map(), grillErrors: new Map(),
    stackJob: null };
  const server = http.createServer(handler(cfg));
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    // Only this machine. The phone reaches it through an SSH local port forward.
    server.listen(port, '127.0.0.1', () => resolve({ server, cfg, port: server.address().port }));
  });
}

if (require.main === module) {
  const env = process.env;
  start({ home: env.SNOWMOBILE_HOME || undefined, port: env.PORT ? Number(env.PORT) : undefined,
    claude: env.SNOWMOBILE_CLAUDE || undefined }).then(({ cfg, port }) => {
    console.log(`snowmobile: http://127.0.0.1:${port}/?token=${cfg.token}`);
    console.log(`database:   ${path.join(cfg.home, 'snowmobile.db')}`);
    console.log(`phone:      ssh -L ${port}:127.0.0.1:${port} <this-machine>, then open the same URL`);
  }, (e) => { console.error(`snowmobile: ${e.message}`); process.exit(1); });
}

module.exports = { start, eigen, pca, gaps, practicalProblems, ideaProblems };

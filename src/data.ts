export type Layer = 'language' | 'hardware' | 'os' | 'software';
export const LAYER_KEYS: readonly Layer[] = ['language', 'hardware', 'os', 'software'];

export type ParadigmSeed = readonly [name: string, summary: string, url: string];
export type ProblemId = 'technical-debt' | 'build-complexity' | 'deployment-complexity' | 'unreliable-tools';
export interface ProblemLink {
  paradigm: string;
  layer: Layer;
  problem_id: ProblemId;
  effect: 'reduces' | 'worsens';
  reason: string;
  source: { title: string; url: string };
}

export const LAYERS: Record<Layer, string> = { language: 'Programming language', hardware: 'Hardware', os: 'Operating system', software: 'Software' };

// Reason: the Stack API had no sourced practical problems for the map or idea seed.
export interface ProblemItem { id: ProblemId; name: string; percent: number }
export interface PracticalProblems {
  source: { title: string; url: string; checked: string; respondents: number; scope: string; measure: string; limit: string };
  items: readonly ProblemItem[];
}

export const PRACTICAL_PROBLEMS: PracticalProblems = {
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
export const START: Record<Layer, readonly ParadigmSeed[]> = {
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
export const MISMATCH = 5;

// Reason: the API trial found zero links and no measure of problems without a documented reduction.
export const PROBLEM_LINKS: readonly ProblemLink[] = [
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

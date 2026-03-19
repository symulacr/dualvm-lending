## DualVM Lending — M11 Bilateral Async Unified Architecture (Mermaid Diagrams)

All diagrams reflect the M11 `bilateral-async-unified` milestone state with canonical contract names,
correlationId event flows, GovernancePolicyStore, and AccessManager governance reach.

---

### System Overview (M11 Canonical)

```mermaid
graph TB
    subgraph GOV["Governance Root"]
        GT["GovernanceToken\n(ERC20Votes+Permit)"] --> GOVR["DualVMGovernor"]
        GOVR --> TL["TimelockController\n0x9e1a91..."]
        TL --> AM["AccessManager\n0xc7F587...\n(admin: timelock only)"]
    end

    subgraph REVM["REVM Contracts — Polkadot Hub TestNet (chain 420420417)"]
        direction TB

        subgraph CORE["Lending Core System"]
            LE["LendingEngine\n0x74924a...\ncorrelationId in all events\ndepositCollateralFor\nbatch liquidate"]
            DP["DebtPool\n0x1A024F...\nERC-4626 vault\nsupply cap, reserves"]
            MO["ManualOracle\n0xF751Cc...\npriceWad, circuit breaker\nmaxAge=1800s"]
        end

        subgraph RISK["Risk System"]
            RG["RiskGateway\n0x01E569...\ninline kinked-curve = CANONICAL\n+ optional PVM verify\nreads GovernancePolicyStore"]
            GPS["GovernancePolicyStore\n0x3471F5...\nsetPolicy (RISK_ADMIN)\nmaxLtvOverrideBps, etc."]
        end

        subgraph HOOKS["Hook Dispatch Chain"]
            HR["LiquidationHookRegistry\n0xa80eAC...\ngovernance-managed hooks\ntry/catch dispatch\nforwards correlationId"]
            XNA["XcmNotifierAdapter\n0x302725...\n3→4 arg bridge\nforwards correlationId"]
            XLN["XcmLiquidationNotifier\n0x051eBa...\nClearOrigin+SetTopic(correlationId)\nXCM V5 message"]
        end

        subgraph INBOX["Async Receipt"]
            XI["XcmInbox\n0x6df5e3...\nreceiveReceipt(correlationId)\nDuplicateCorrelationId dedup\nReceiptReceived event"]
        end

        subgraph UX["UX + Assets"]
            LR["LendingRouter\n0xC6dC17...\ndepositCollateralFromPAS\ncredits USER position"]
            WPAS["WPAS\n0x88197...\nnative wrapper"]
            USDC["USDCMock\n0xd39451...\ntest ERC-20"]
        end

        subgraph MGMT["Market Management"]
            MVR["MarketVersionRegistry\n0x685B2c...\nregister/activate versions"]
            MMC["MarketMigrationCoordinator\n0x7d8F63...\nborrower + liquidity migration"]
        end
    end

    subgraph PVM["PVM Domain (PolkaVM via resolc)"]
        DRM["DeterministicRiskModel\n0xC6907B...\nresolc-compiled\nstateless quote()\nRiskGateway's quoteEngine"]
    end

    subgraph XCM_P["XCM Precompile"]
        XPC["IXcm @ 0x...0A0000\nexecute / send / weighMessage\n(all proven on testnet)"]
    end

    subgraph OPS["Off-chain Ops"]
        EC["Event Correlator\n(TypeScript script)\ncorrelates by correlationId\nLendingEngine+XcmInbox+XcmLiquidationNotifier"]
    end

    %% Access control reach
    AM -->|restricted| LE & RG & DP & MO & HR & XI & GPS & MVR & MMC

    %% Core lending flow
    LE -->|quoteViaTicket LENDING_CORE role| RG
    RG -->|_inlineQuote canonical| RG
    RG -->|getPolicy view| GPS
    RG -->|try/catch cross-VM| DRM
    LE -->|draw/repay/loss| DP
    LE -->|price view| MO

    %% CorrelationId hook chain
    LE -->|notifyLiquidation correlationId try/catch| HR
    HR -->|executeHooks correlationId| XNA
    XNA -->|forward correlationId| XLN
    XLN -->|send ClearOrigin+SetTopic| XPC

    %% Async receipt path
    XI -.->|matched by correlationId| EC
    XLN -.->|LiquidationNotified event| EC
    LE -.->|Liquidated event| EC

    %% Router
    LR -->|depositCollateralFor ROUTER role| LE
    LR --> WPAS

    %% Governance
    AM -->|governed by| GOV
    GPS -.->|PVM reads params| DRM

    %% Styling
    classDef good fill:#27ae60,stroke:#1e8449,color:#fff
    classDef warning fill:#f39c12,stroke:#e67e22,color:#fff
    classDef pvm fill:#8e44ad,stroke:#6c3483,color:#fff
    classDef xcm fill:#2980b9,stroke:#1a6090,color:#fff
    classDef gov fill:#c0392b,stroke:#922b21,color:#fff

    class LE,RG,DP,MO,GPS,HR,XNA,XI,LR good
    class DRM pvm
    class XLN,XPC xcm
    class GOVR,TL,AM,GT gov
```

---

### Bilateral Adapter Paths

The bilateral system uses adapters to bridge platform limitations:

```mermaid
graph LR
    subgraph EVM["EVM (REVM) — initiates all calls"]
        LE[LendingEngine]
        RG["RiskGateway\n(inline math = canonical)"]
        GPS[GovernancePolicyStore]
        HR[LiquidationHookRegistry]
        XNA[XcmNotifierAdapter]
        XI[XcmInbox]
    end

    subgraph PVM["PVM (PolkaVM) — passive callee"]
        DRM["DeterministicRiskModel\n(resolc-compiled)"]
    end

    subgraph XCM["XCM Layer"]
        XLN[XcmLiquidationNotifier]
        XPC["XCM Precompile\n0x...0A0000"]
        RC[Relay Chain]
    end

    subgraph OFFCHAIN["Off-chain"]
        EC[Event Correlator]
    end

    %% Bilateral path 1: PVM ↔ RiskGateway
    RG -->|"sync REVM→PVM call\n(quoteEngine.quote())"| DRM
    DRM -->|"sync return QuoteOutput\n(bilateral via call/return)"| RG

    %% Bilateral path 2: PVM policy ↔ AccessManager
    GPS -->|"PVM reads policy params\n(sync cross-VM read)"| DRM
    AM["AccessManager\n(RISK_ADMIN role)"] -->|"setPolicy restricted call"| GPS

    %% Bilateral path 3: XCM ↔ LendingEngine  
    LE -->|"liquidate → notifyLiquidation\n(correlationId)"| HR
    HR --> XNA --> XLN
    XLN -->|"IXcm.send\nClearOrigin+SetTopic(correlationId)"| XPC
    XPC -->|"async delivery"| RC
    RC -.->|"XCM receipt arrives\n(off-chain relay)"| XI
    XI -->|"ReceiptReceived(correlationId)"| EC
    LE -->|"Liquidated(correlationId)"| EC
    XLN -->|"LiquidationNotified"| EC

    note["NOTE: PVM→REVM direct callbacks\nremain broken at platform level.\nDesign uses REVM→PVM sync calls only.\nBilateral is achieved via adapters."]
```

---

### CorrelationId Event Flows

```mermaid
sequenceDiagram
    participant U as User
    participant LE as LendingEngine
    participant RG as RiskGateway
    participant DRM as DeterministicRiskModel (PVM)
    participant HR as LiquidationHookRegistry
    participant XNA as XcmNotifierAdapter
    participant XLN as XcmLiquidationNotifier
    participant XPC as XCM Precompile
    participant XI as XcmInbox
    participant EC as Event Correlator

    U->>LE: liquidate(borrower, amount)
    LE->>LE: correlationId = keccak256(chainid, blockNum, sender, nonce++)
    LE->>RG: quoteViaTicket(context, input)
    RG->>RG: _inlineQuote() [canonical]
    RG->>DRM: quoteEngine.quote() [optional PVM verify, try/catch]
    DRM-->>RG: QuoteOutput (or try/catch failure)
    RG-->>LE: QuoteTicket
    LE->>LE: emit Liquidated(correlationId, borrower, liquidator, ...)
    LE->>HR: notifyLiquidation(borrower, debt, collateral, correlationId) [try/catch]
    HR->>XNA: executeHooks(borrower, debt, collateral, correlationId) [try/catch]
    XNA->>XLN: notifyLiquidation(borrower, debt, collateral, correlationId)
    XLN->>XPC: IXcm.send(relay, ClearOrigin+SetTopic(correlationId))
    XLN->>XLN: emit LiquidationNotified(borrower, repaid, seized)
    Note over EC: Off-chain: watches Liquidated + LiquidationNotified events
    Note over EC: Correlates by correlationId → unified audit trail
    
    Note over XI: Async: relay delivers XCM receipt
    U->>XI: receiveReceipt(correlationId, data) [RELAY_CALLER role]
    XI->>XI: check !processed[correlationId]
    XI->>XI: processed[correlationId] = true
    XI->>XI: emit ReceiptReceived(correlationId, sender, data)
    EC->>EC: matches Liquidated↔ReceiptReceived by correlationId
```

---

### GovernancePolicyStore in Diagram

```mermaid
graph TD
    subgraph GOV_REACH["Governance Reach to PVM via PolicyStore"]
        GOV[DualVMGovernor]
        TL[TimelockController]
        AM[AccessManager]
        GPS["GovernancePolicyStore\n(REVM contract)\nsetPolicy → maxLtvOverrideBps, etc."]
        RG["RiskGateway\n(REVM contract)\nreads GPS if policyActive"]
        DRM["DeterministicRiskModel\n(PVM contract)\nstateless, receives params via\nRG inline path\nor reads GPS via sync cross-VM call"]
    end

    GOV -->|propose/vote/queue/execute| TL
    TL -->|executor holds admin| AM
    AM -->|RISK_ADMIN role, 60s delay| GPS
    GPS -->|getPolicy view| RG
    RG -->|quoteEngine.quote with policy params| DRM

    note1["AccessManager cannot directly govern\nPVM contracts (EVM-only). GovernancePolicyStore\nis the bridge: governance sets REVM params,\nPVM reads via sync cross-VM call."]
```

---

### AccessManager Governance Reach

```mermaid
graph TD
    GOV[DualVMGovernor] --> TL[TimelockController]
    TL --> AM[AccessManager]

    AM --> RISK["RISK_ADMIN\ndelay: 60s"]
    AM --> TREAS["TREASURY\ndelay: 60s"]
    AM --> MINT["MINTER\ndelay: 60s"]
    AM --> EMRG["EMERGENCY\ndelay: 0s"]
    AM --> LC_ROLE["LENDING_CORE\n(LendingEngine address)"]
    AM --> RTR_ROLE["ROUTER\n(LendingRouter address)"]
    AM --> GOV_ROLE["GOVERNANCE\n(TimelockController)"]
    AM --> RELAY_ROLE["RELAY_CALLER\n(authorized relay)"]

    RISK --> fn1["ManualOracle.setPrice\nManualOracle.setMaxAge\nGovernancePolicyStore.setPolicy"]
    TREAS --> fn2["DebtPool.claimReserves"]
    MINT --> fn3["USDCMock.mint"]
    EMRG --> fn4["*.pause()\nLendingEngine.freezeNewDebt"]
    LC_ROLE --> fn5["RiskGateway.quoteViaTicket\nDebtPool.drawDebt/recordRepayment"]
    RTR_ROLE --> fn6["LendingEngine.depositCollateralFor"]
    GOV_ROLE --> fn7["MarketVersionRegistry.registerVersion\nMarketVersionRegistry.activateVersion\nLiquidationHookRegistry.registerHook"]
    RELAY_ROLE --> fn8["XcmInbox.receiveReceipt"]

    subgraph GOVERNED["All governed contracts return authority()==AccessManager"]
        LE[LendingEngine]
        RG[RiskGateway]
        DP[DebtPool]
        MO[ManualOracle]
        GPS[GovernancePolicyStore]
        HR[LiquidationHookRegistry]
        XI[XcmInbox]
        MVR[MarketVersionRegistry]
        MMC[MarketMigrationCoordinator]
    end
```

---

### Contract Dependency Graph (M11)

```mermaid
graph TD
    GOV[DualVMGovernor] --> TL[TimelockController]
    TL --> AM[AccessManager]

    AM -->|controls| LE[LendingEngine]
    AM -->|controls| RG[RiskGateway]
    AM -->|controls| DP[DebtPool]
    AM -->|controls| MO[ManualOracle]
    AM -->|controls| GPS[GovernancePolicyStore]
    AM -->|controls| HR[LiquidationHookRegistry]
    AM -->|controls| XI[XcmInbox]
    AM -->|controls| MVR[MarketVersionRegistry]
    AM -->|controls| MMC[MarketMigrationCoordinator]

    LE --> MO
    LE --> RG
    LE <--> DP
    LE -->|notifyLiquidation try/catch| HR
    RG -->|getPolicy| GPS
    RG -.->|optional cross-VM| DRM[DeterministicRiskModel PVM]
    GPS -.->|policy params read| DRM

    HR --> XNA[XcmNotifierAdapter]
    XNA --> XLN[XcmLiquidationNotifier]
    XLN -->|IXcm.send| XPC["XCM Precompile\n0x...0A0000"]

    LE --- WPAS[WPAS Collateral]
    DP --- USDC[USDCMock Debt]
    MVR --> MMC
    LR[LendingRouter] -->|depositCollateralFor| LE
```

---

### ASCII System Board (M11)

```
╔══════════════════════════════════════════════════════════════════════════════════════════════════════════╗
║                       DualVM Lending — M11 Bilateral Async System Board (2026-03-19)                   ║
╠══════════════════════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                                        ║
║  ┌─────────────────────────────── FRONTEND (Vite + React 18) ────────────────────────────────────┐     ║
║  │  wagmi 2.19 + viem 2.37 + RainbowKit 2.2                                                      │     ║
║  │  TabNav: [Lend & Borrow | Market Data | Protocol Info]                                         │     ║
║  │  WritePathSection: deposit/borrow/repay/liquidate/supply/withdraw                              │     ║
║  │  ObserverSection: healthFactor (4-color), liquidationPrice, Max buttons                         │     ║
║  └────────────────────────────────────────────────────────────────────────────────────────────────┘     ║
║                           │ JSON-RPC (eth-rpc-testnet.polkadot.io)                                     ║
║                           ▼                                                                            ║
║  ┌──────────────────── POLKADOT HUB TESTNET (Chain 420420417) ──────────────────────────────────┐     ║
║  │                                                                                                │     ║
║  │   ┌──────────── REVM (EVM-compatible) ─────────────────────────────────────────────────┐      │     ║
║  │   │                                                                                     │      │     ║
║  │   │  ╔══════════════╗  ╔══════════════╗  ╔════════════════════╗                         │      │     ║
║  │   │  ║ AccessManager║  ║GovernorStack ║  ║ GovernancePolicyStore╗                       │      │     ║
║  │   │  ║ governs all  ║  ║Gov→TL→AM    ║  ║ setPolicy (RISK_ADMIN 60s)║                   │      │     ║
║  │   │  ║ REVM contracts║  ╚══════╤═══════╝  ║ maxLtvOverrideBps   ║                        │      │     ║
║  │   │  ╚══════╤════════╝         │           ╚══════╤══════════════╝                        │      │     ║
║  │   │         │                  └──────────────────┘                                      │      │     ║
║  │   │         ▼                                                                             │      │     ║
║  │   │  ╔═══════════════════╗  ◄── ManualOracle (maxAge=1800s, circuit breaker)             │      │     ║
║  │   │  ║   LendingEngine   ║                                                               │      │     ║
║  │   │  ║ borrow/repay/liq  ║────────────────────►╔══════════════════╗                     │      │     ║
║  │   │  ║ batch liquidate   ║                     ║   RiskGateway     ║                    │      │     ║
║  │   │  ║ depositCollateralFor║                   ║ INLINE kinked    ║                    │      │     ║
║  │   │  ║ correlationId events║                   ║ curve = CANONICAL║───► GovernancePolicyStore  │      │     ║
║  │   │  ╚═══════╤═════════╤═╝                     ║ + optional PVM   ║───► DeterministicRiskModel(PVM)  │      │     ║
║  │   │          │         │                        ╚══════════════════╝                    │      │     ║
║  │   │          │         ▼                                                                 │      │     ║
║  │   │          │  ╔══════════════════╗   ╔══════════════════╗                             │      │     ║
║  │   │          │  ║   DebtPool       ║   ║   LendingRouter  ║                            │      │     ║
║  │   │          │  ║ ERC-4626 vault   ║   ║ PAS→WPAS→        ║                            │      │     ║
║  │   │          │  ║ supply cap, resv ║   ║ depositCollateralFor║                          │      │     ║
║  │   │          │  ╚══════════════════╝   ║ (credits USER ✓) ║                            │      │     ║
║  │   │          │                          ╚══════════════════╝                            │      │     ║
║  │   │          │ correlationId                                                             │      │     ║
║  │   │          ▼                                                                           │      │     ║
║  │   │  ╔══════════════════════╗                                                           │      │     ║
║  │   │  ║ LiquidationHookRegistry║ ──► XcmNotifierAdapter ──► XcmLiquidationNotifier       │      │     ║
║  │   │  ║ try/catch dispatch   ║                            SetTopic(correlationId)          │      │     ║
║  │   │  ║ HookFailed non-block ║                            ──► XCM Precompile              │      │     ║
║  │   │  ╚══════════════════════╝                                                           │      │     ║
║  │   │                                                                                      │      │     ║
║  │   │  ╔══════════════════════╗                                                           │      │     ║
║  │   │  ║ XcmInbox             ║ receiveReceipt(correlationId)  ◄── off-chain relay        │      │     ║
║  │   │  ║ DuplicateCorrelation ║ ReceiptReceived event                                     │      │     ║
║  │   │  ║ dedup (processed map)║                                                           │      │     ║
║  │   │  ╚══════════════════════╝                                                           │      │     ║
║  │   └─────────────────────────────────────────────────────────────────────────────────────┘      │     ║
║  │                                                                                                │     ║
║  │   ┌──────────── PVM (PolkaVM / RISC-V) ─── deployed via resolc ─────────────────────────┐     │     ║
║  │   │                                                                                      │     │     ║
║  │   │  ╔══════════════════════╗                                                           │     │     ║
║  │   │  ║ DeterministicRiskModel║ ◄── resolc compiled, quoteEngine for RiskGateway         │     │     ║
║  │   │  ║ 0xC6907B609...       ║     Stage 1 EVM→PVM echo+quote ✓                         │     │     ║
║  │   │  ║ stateless quote()    ║     PVM→REVM callbacks: ✗ (platform level)               │     │     ║
║  │   │  ╚══════════════════════╝                                                           │     │     ║
║  │   └──────────────────────────────────────────────────────────────────────────────────────┘     │     ║
║  │                                                                                                │     ║
║  │   ┌──────────── OFF-CHAIN ─────────────────────────────────────────────────────────────┐      │     ║
║  │   │ Event Correlator (TypeScript)                                                       │      │     ║
║  │   │   watches: LendingEngine.Liquidated(correlationId)                                 │      │     ║
║  │   │   watches: XcmLiquidationNotifier.LiquidationNotified                              │      │     ║
║  │   │   watches: XcmInbox.ReceiptReceived(correlationId)                                 │      │     ║
║  │   │   correlates: by correlationId → unified audit trail (JSON)                        │      │     ║
║  │   └─────────────────────────────────────────────────────────────────────────────────────┘      │     ║
║  └────────────────────────────────────────────────────────────────────────────────────────────────┘     ║
║                                                                                                        ║
║  ┌──────────── M11 CANONICAL DEPLOYMENT ──────────────────────────────────────────────────────────┐    ║
║  │  Toolchain: Foundry (forge build, forge test, forge script) — Hardhat fully removed             │    ║
║  │  Tests: 291 Foundry tests pass (18 *.t.sol files)                                               │    ║
║  │  Canonical manifest: deployments/polkadot-hub-testnet-m11-canonical.json                        │    ║
║  │  Governance: DualVMGovernor→TimelockController→AccessManager, deployer has NO admin             │    ║
║  │  Key addresses:                                                                                  │    ║
║  │    LendingEngine:           0x74924a4502f666023510ED21Ae6E27bC47eE6485                          │    ║
║  │    RiskGateway:             0x01E56920355f1936c28A2EA627D027E35EccBca6                          │    ║
║  │    GovernancePolicyStore:   0x3471F542f66603a1899947fE5849a612f0A7f465                          │    ║
║  │    LendingRouter:           0xC6dC173de67FF347c864d4F26a96c5e725099394                          │    ║
║  │    LiquidationHookRegistry: 0xa80eAC309424FD3FA0daaF7200F5c2ab2bcb9B9A                          │    ║
║  │    XcmInbox:                0x6df5e3694976fd46Df67b1E6A7BdE85B39271719                          │    ║
║  │    AccessManager:           0xc7F5871c0223eE42A858b54a679364c92C8CB0E8                          │    ║
║  │    DebtPool:                0x1A024F0232Bab9D6282Efbf533F11e11511d68a8                          │    ║
║  └────────────────────────────────────────────────────────────────────────────────────────────────┘    ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════════╝
```

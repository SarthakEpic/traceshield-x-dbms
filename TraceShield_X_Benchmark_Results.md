# TraceShield X Benchmark Evidence

This is a machine-specific local engineering baseline. It is not a production capacity claim, a security certification, or proof of patentability. Re-run it after changing Node, hardware, token parameters, or the ingestion model.

## Command

```powershell
cd "D:\Projects\DBMS Project\investigation-app"
npm run benchmark
```

## Latest recorded run

The run used Node `v22.16.0` and the default deterministic iteration counts:

| Workload | Iterations | Observed result |
| --- | ---: | ---: |
| Context-bound HMAC token derivation | 20,000 | 61,250 operations/second |
| Ingestion normalisation | 200 | 3,966 operations/second |
| Investigation analysis | 200 | 9,911 operations/second |
| In-memory clear-reference join | 2,000 | 1,154,068 operations/second |
| In-memory context-bound token join | 2,000 | 40,757 operations/second |

The clear-reference comparison is an in-memory fixture only. It is included to make the privacy/performance trade-off explicit; raw identifiers are not persisted, returned, or logged by the application. The numbers should be presented with hardware, Node version, PostgreSQL version, dataset size, and p95 measurements in any serious report.

## Required next experiment for a patent package

Repeat with fixed synthetic datasets at 1k, 10k, and 100k records, record median and p95 latency, compare two-hop/three-hop/five-hop paths, measure duplicate/conflict replay, and report false positives for shared-device scenarios. Keep raw-reference fixtures isolated from the application database and destroy them after the experiment.

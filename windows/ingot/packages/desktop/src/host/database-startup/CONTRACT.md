# Host database startup

Host Worker Yes app 库StartPreparation的唯Oneactor。宿主验证 progress/done/failed 帧后更NewStartStatus；Input只携带Data库路径。

先ReadOld settings，再调用 project-storage 的Start入口迁移and维护索引，Completed后Send done，FailedRetainStructures化Error及已经Submit的迁移事实。所有Exit路径Close MessagePort。此顺序避免空Settings先记账、之后无法再恢复OldProject种子。

构建产物仍为 host/tasksStorageWorker.js，Cancel、超时及进程代际仍由宿主原有Manage器负责；不改变历史 SQL、checksum or attachment。

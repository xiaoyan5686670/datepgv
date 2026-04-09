# 增量数据同步方案 (PostgreSQL -> Neo4j)

由于主库是 PostgreSQL，我们推荐使用 **Debezium** 监听 PostgreSQL 的 WAL (Write-Ahead Log) 进行 CDC (Change Data Capture) 同步。

## 方案一：Debezium CDC (推荐，解耦业务)
1. **配置 PostgreSQL**
   修改 `postgresql.conf` 开启逻辑复制：
   ```ini
   wal_level = logical
   max_wal_senders = 10
   max_replication_slots = 10
   ```
2. **部署 Debezium Connector**
   使用 Kafka Connect 部署 Debezium PostgreSQL Connector，将变更推送到 Kafka Topic。
3. **消费 Kafka 写入 Neo4j**
   编写消费者服务（Python/Go/Java），订阅 Kafka Topic，将 `INSERT/UPDATE/DELETE` 转换为 Cypher 语句。

## 方案二：应用层异步双写 (降级方案，适合初期快速验证)
在业务代码中，当发生关系变更时，先写入 PostgreSQL，成功后发送异步消息（如 RabbitMQ/Redis Queue）给后台 Worker，Worker 负责写入 Neo4j。

### 异步双写 Worker 示例 (Python)
```python
from neo4j import GraphDatabase
import pika
import json

# Neo4j Driver
driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "password123"))

def process_message(ch, method, properties, body):
    event = json.loads(body)
    action = event.get('action')
    data = event.get('data')
    
    with driver.session() as session:
        if action == 'CREATE_USER':
            session.run("MERGE (u:User {id: $id}) SET u.status = $status", id=data['id'], status=data['status'])
        elif action == 'ADD_USER_TO_ORG':
            session.run('''
                MATCH (u:User {id: $user_id})
                MATCH (o:Organization {id: $org_id})
                MERGE (u)-[r:BELONGS_TO]->(o)
                SET r.join_date = $join_date
            ''', user_id=data['user_id'], org_id=data['org_id'], join_date=data['join_date'])
        elif action == 'REMOVE_USER_FROM_ORG':
            session.run('''
                MATCH (u:User {id: $user_id})-[r:BELONGS_TO]->(o:Organization {id: $org_id})
                DELETE r
            ''', user_id=data['user_id'], org_id=data['org_id'])
            
    print(f"Processed event: {action}")
    ch.basic_ack(delivery_tag=method.delivery_tag)

# RabbitMQ Consumer setup
connection = pika.BlockingConnection(pika.ConnectionParameters('localhost'))
channel = connection.channel()
channel.queue_declare(queue='graph_sync_queue')
channel.basic_consume(queue='graph_sync_queue', on_message_callback=process_message)

print('Waiting for messages. To exit press CTRL+C')
channel.start_consuming()
```

import psycopg2
import time
import os

# PostgreSQL Connection Config
PG_HOST = os.getenv("PG_HOST", "localhost")
PG_PORT = os.getenv("PG_PORT", "5432")
PG_USER = os.getenv("PG_USER", "postgres")
PG_PASS = os.getenv("PG_PASS", "postgres")
PG_DB = os.getenv("PG_DB", "mydb")

def run_age_poc():
    try:
        conn = psycopg2.connect(host=PG_HOST, port=PG_PORT, user=PG_USER, password=PG_PASS, dbname=PG_DB)
        conn.autocommit = True
        cur = conn.cursor()

        # 1. 确保 AGE 环境就绪
        cur.execute("LOAD 'age';")
        cur.execute("SET search_path = ag_catalog, \"$user\", public;")
        
        # 如果图不存在，则创建
        cur.execute("SELECT count(*) FROM ag_graph WHERE name = 'my_graph';")
        if cur.fetchone()[0] == 0:
            cur.execute("SELECT create_graph('my_graph');")
            print("Created graph 'my_graph'.")

        # 2. 插入测试数据 (模拟组织架构或社交网络)
        print("Inserting test nodes and edges into Apache AGE...")
        insert_cypher = """
        SELECT * FROM cypher('my_graph', $$
            CREATE (a:User {id: 1, name: 'Alice'}),
                   (b:User {id: 2, name: 'Bob'}),
                   (c:User {id: 3, name: 'Charlie'}),
                   (d:User {id: 4, name: 'David'}),
                   (a)-[:REFERRED]->(b),
                   (b)-[:REFERRED]->(c),
                   (c)-[:REFERRED]->(d)
            RETURN a
        $$) as (a agtype);
        """
        cur.execute(insert_cypher)

        # 3. 执行复杂关系查询 (POC: 查询 Alice 推荐的所有下级网络，深度为 1 到 3 层)
        print("Running complex graph query (Recursive CTE equivalent)...")
        query_cypher = """
        SELECT * FROM cypher('my_graph', $$
            MATCH (u:User {id: 1})-[:REFERRED*1..3]->(sub:User)
            RETURN sub.id, sub.name
        $$) as (id agtype, name agtype);
        """
        
        start_time = time.time()
        cur.execute(query_cypher)
        results = cur.fetchall()
        end_time = time.time()

        print(f"Query Results (Subordinates of Alice):")
        for row in results:
            print(f" - ID: {row[0]}, Name: {row[1]}")
            
        print(f"Query executed in {(end_time - start_time) * 1000:.2f} ms")

        # 4. 清理测试数据 (可选)
        # cur.execute("SELECT drop_graph('my_graph', true);")

        cur.close()
        conn.close()

    except Exception as e:
        print(f"Error running Apache AGE POC: {e}")

if __name__ == "__main__":
    run_age_poc()

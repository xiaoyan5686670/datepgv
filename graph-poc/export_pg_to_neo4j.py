import psycopg2
import csv
import os

# PostgreSQL Connection Config
PG_HOST = os.getenv("PG_HOST", "localhost")
PG_PORT = os.getenv("PG_PORT", "5432")
PG_USER = os.getenv("PG_USER", "postgres")
PG_PASS = os.getenv("PG_PASS", "postgres")
PG_DB = os.getenv("PG_DB", "mydb")

# Neo4j Import Directory (Mapped in Docker Compose)
IMPORT_DIR = "./neo4j/import"

def export_nodes():
    conn = psycopg2.connect(host=PG_HOST, port=PG_PORT, user=PG_USER, password=PG_PASS, dbname=PG_DB)
    cur = conn.cursor()
    
    print("Exporting User nodes...")
    cur.execute("SELECT id, status FROM users")
    with open(f"{IMPORT_DIR}/users.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id:ID(User)", "status"])
        for row in cur:
            writer.writerow(row)
            
    print("Exporting Organization nodes...")
    cur.execute("SELECT id, level FROM organizations")
    with open(f"{IMPORT_DIR}/organizations.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id:ID(Organization)", "level"])
        for row in cur:
            writer.writerow(row)
            
    cur.close()
    conn.close()

def export_edges():
    conn = psycopg2.connect(host=PG_HOST, port=PG_PORT, user=PG_USER, password=PG_PASS, dbname=PG_DB)
    cur = conn.cursor()
    
    print("Exporting BELONGS_TO edges...")
    cur.execute("SELECT user_id, organization_id, join_date FROM user_organizations")
    with open(f"{IMPORT_DIR}/belongs_to.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([":START_ID(User)", ":END_ID(Organization)", "join_date"])
        for row in cur:
            writer.writerow(row)
            
    cur.close()
    conn.close()

def generate_import_script():
    script = """
# Run this command inside the neo4j container to import data
bin/neo4j-admin database import full \\
  --nodes=User=import/users.csv \\
  --nodes=Organization=import/organizations.csv \\
  --relationships=BELONGS_TO=import/belongs_to.csv \\
  --overwrite-destination=true \\
  neo4j
"""
    with open("import_neo4j.sh", "w") as f:
        f.write(script)
    print("Generated import_neo4j.sh")

if __name__ == "__main__":
    os.makedirs(IMPORT_DIR, exist_ok=True)
    try:
        export_nodes()
        export_edges()
    except Exception as e:
        print(f"Warning: Could not connect to PostgreSQL ({e}). Please configure connection settings.")
    generate_import_script()

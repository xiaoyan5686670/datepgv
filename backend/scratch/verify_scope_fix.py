from __future__ import annotations
import sys
import os

# Add backend to sys.path
sys.path.append(os.path.abspath("/Users/qinxiaoyan/work/datepgv/backend"))

from app.services.sql_scope_guard import rewrite_sql_with_scope
from app.services.scope_types import ResolvedScope

class MockUser:
    def __init__(self, full_name, username, employee_level="staff", province=None):
        self.full_name = full_name
        self.username = username
        self.employee_level = employee_level
        self.province = province
        self.roles = []

def test_aggregation_scoping():
    # Scenario: Area Manager '荀海琪' queries their performance
    scope = ResolvedScope(
        unrestricted=False,
        employee_values={'荀海琪'}
    )
    user = MockUser(full_name='荀海琪', username='XY001', employee_level='area_manager')
    
    sql = """
    SELECT 
        SUM(CAST(IFNULL(`t`.`CLAIMED_AMOUNT`, 0) AS DECIMAL(20,2))) AS `yesterday_performance`
    FROM 
        `DWD`.`DWD_SLS_PAYMENT_ACK_STAFF` AS `t`
    WHERE 
        `t`.`AREA_MGR_NAME` = '荀海琪'
        AND DATE_FORMAT(`t`.`CLAIM_DATE`, "%Y-%m-%d") = '2026-04-15'
    """
    
    result = rewrite_sql_with_scope(sql, "mysql", scope, user)
    
    print("Original SQL:")
    print(sql)
    print("\nRewritten SQL:")
    print(result.sql)
    print("\nScope Applied:", result.scope_applied)
    print("\nIs Comprehensive:", result.is_comprehensive)
    print("\nNote:", result.rewrite_note)

    assert result.is_comprehensive is True
    assert "'荀海琪'" in result.sql

def test_injection():
    # Scenario: No WHERE clause, should inject
    scope = ResolvedScope(
        unrestricted=False,
        province_values={'广东省'}
    )
    user = MockUser(full_name='Test', username='T001', employee_level='staff', province='广东省')
    
    sql = "SELECT SUM(amount) FROM sales"
    result = rewrite_sql_with_scope(sql, "mysql", scope, user)
    
class MockTableMetadata:
    def __init__(self, table_name, columns):
        self.table_name = table_name
        self.columns = columns

def test_metadata_aware_injection():
    # Table 'sales' has 'shengfen' but not 'province'
    # Table 'users' has no region info
    tables_metadata = [
        MockTableMetadata("sales", [
            {"name": "id", "type": "int"},
            {"name": "amount", "type": "decimal"},
            {"name": "shengfen", "type": "string"}, # This should be matched as province
            {"name": "yewujingli", "type": "string"}, # This should be matched as sales_name
        ])
    ]
    
    scope = ResolvedScope(
        unrestricted=False,
        province_values={'广东省'},
        employee_values={'荀海琪'},
        region_values={'华南'} # Note: 'sales' has no region column in metadata
    )
    user = MockUser(full_name='Test', username='T001', employee_level='staff')
    
    sql = "SELECT SUM(amount) FROM sales"
    result = rewrite_sql_with_scope(sql, "mysql", scope, user, tables_metadata)
    
    print("\nInput: " + sql)
    print("Result: " + result.sql)
    
    # Assertions
    # 1. Should use 'shengfen' instead of hallucinated 'province'
    assert "shengfen" in result.sql
    assert "province" not in result.sql
    
    # 2. Should use 'yewujingli' instead of hardcoded 'sales_name'
    assert "yewujingli" in result.sql
    assert "sales_name" not in result.sql
    
    # 3. Should NOT inject 'region' since it's not in metadata (Avoid hallucination)
    assert "region" not in result.sql.lower()

def test_alias_injection():
    tables_metadata = [
        MockTableMetadata("sales", [{"name": "shengfen", "type": "string"}])
    ]
    scope = ResolvedScope(unrestricted=False, province_values={'广东省'})
    user = MockUser(full_name='Test', username='T001')
    
    sql = "SELECT * FROM sales AS s"
    result = rewrite_sql_with_scope(sql, "mysql", scope, user, tables_metadata)
    
    print("\nInput: " + sql)
    print("Result: " + result.sql)
    assert "s.shengfen" in result.sql

def test_unauthorized_mention_blocking():
    # Scenario: User '荀海琪' asks for '刘纪港'
    scope = ResolvedScope(
        unrestricted=False,
        employee_values={'荀海琪'} # Only allowed to see themselves
    )
    user = MockUser(full_name='荀海琪', username='XY000896', employee_level='area_manager')
    
    # Query mentions '刘纪港'
    sql = "SELECT SUM(amount) FROM sales WHERE mgr_name = '刘纪港'"
    result = rewrite_sql_with_scope(sql, "mysql", scope, user)
    
    print("\nInput: " + sql)
    print("Should Block:", result.should_block)
    print("Block Reason:", result.block_reason)
    
    assert result.should_block is True
    assert "刘纪港" in result.block_reason
    assert "未授权员工" in result.block_reason

if __name__ == "__main__":
    try:
        test_aggregation_scoping()
        test_alias_injection()
        test_unauthorized_mention_blocking()
        print("\nVerification SUCCESS!")
    except Exception as e:
        print(f"\nVerification FAILED: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

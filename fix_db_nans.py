
import math
from sqlmodel import Session, select
from main_api import engine, Product, StockMovement

def fix_nans():
    with Session(engine) as session:
        print("Checking Products for NaNs...")
        products = session.exec(select(Product)).all()
        fixed_products = 0
        for p in products:
            changed = False
            if math.isnan(p.stock_quantity) or math.isinf(p.stock_quantity):
                print(f"Product {p.id} ({p.name}): stock_quantity {p.stock_quantity} -> 0.0")
                p.stock_quantity = 0.0
                changed = True
            if math.isnan(p.purchase_price) or math.isinf(p.purchase_price):
                print(f"Product {p.id} ({p.name}): purchase_price {p.purchase_price} -> 0.0")
                p.purchase_price = 0.0
                changed = True
            if math.isnan(p.retail_price) or math.isinf(p.retail_price):
                print(f"Product {p.id} ({p.name}): retail_price {p.retail_price} -> 0.0")
                p.retail_price = 0.0
                changed = True
            if math.isnan(p.min_stock_level) or math.isinf(p.min_stock_level):
                print(f"Product {p.id} ({p.name}): min_stock_level {p.min_stock_level} -> 0.0")
                p.min_stock_level = 0.0
                changed = True
            
            if changed:
                session.add(p)
                fixed_products += 1
        
        print(f"Fixed {fixed_products} products.")

        print("\nChecking StockMovements for NaNs...")
        movements = session.exec(select(StockMovement)).all()
        fixed_movements = 0
        for m in movements:
            changed = False
            if math.isnan(m.quantity) or math.isinf(m.quantity):
                print(f"Movement {m.id}: quantity {m.quantity} -> 0.0")
                m.quantity = 0.0
                changed = True
            if m.stock_after is not None and (math.isnan(m.stock_after) or math.isinf(m.stock_after)):
                print(f"Movement {m.id}: stock_after {m.stock_after} -> 0.0")
                m.stock_after = 0.0
                changed = True
            
            if changed:
                session.add(m)
                fixed_movements += 1
        
        print(f"Fixed {fixed_movements} stock movements.")
        
        session.commit()
        print("Database commit successful.")

if __name__ == "__main__":
    fix_nans()

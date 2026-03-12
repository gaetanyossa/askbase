"""Create a demo SQLite database with realistic e-commerce data."""

import sqlite3
import os
import random
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), "demo.db")


def create_demo_db():
    """Generate demo.db with customers, products, orders, order_items, reviews."""
    if os.path.exists(DB_PATH):
        return DB_PATH

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # -- Customers --
    c.execute("""CREATE TABLE customers (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        city TEXT,
        country TEXT,
        signup_date DATE,
        age INTEGER
    )""")

    cities = [
        ("Paris", "France"), ("Lyon", "France"), ("Marseille", "France"),
        ("London", "UK"), ("Manchester", "UK"), ("Berlin", "Germany"),
        ("Munich", "Germany"), ("Madrid", "Spain"), ("Barcelona", "Spain"),
        ("Amsterdam", "Netherlands"), ("Brussels", "Belgium"), ("Rome", "Italy"),
    ]
    first_names = ["Alice", "Bob", "Clara", "David", "Emma", "Felix", "Grace", "Hugo",
                   "Iris", "Jules", "Kate", "Leo", "Mia", "Noah", "Olivia", "Paul",
                   "Quinn", "Rosa", "Sam", "Tina", "Uma", "Victor", "Wendy", "Xavier",
                   "Yara", "Zoe", "Adam", "Bella", "Carl", "Diana"]
    last_names = ["Martin", "Bernard", "Dupont", "Thomas", "Robert", "Richard",
                  "Petit", "Durand", "Leroy", "Moreau", "Simon", "Laurent",
                  "Michel", "Garcia", "David", "Bertrand", "Roux", "Vincent"]

    random.seed(42)
    customers = []
    for i in range(1, 201):
        fn = random.choice(first_names)
        ln = random.choice(last_names)
        city, country = random.choice(cities)
        signup = datetime(2023, 1, 1) + timedelta(days=random.randint(0, 730))
        age = random.randint(18, 65)
        customers.append((i, f"{fn} {ln}", f"{fn.lower()}.{ln.lower()}{i}@email.com",
                          city, country, signup.strftime("%Y-%m-%d"), age))
    c.executemany("INSERT INTO customers VALUES (?,?,?,?,?,?,?)", customers)

    # -- Products --
    c.execute("""CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        price REAL,
        stock INTEGER,
        created_date DATE
    )""")

    products_data = [
        (1, "Wireless Headphones", "Electronics", 79.99, 150, "2023-01-15"),
        (2, "USB-C Hub", "Electronics", 49.99, 200, "2023-02-01"),
        (3, "Mechanical Keyboard", "Electronics", 129.99, 80, "2023-03-10"),
        (4, "Running Shoes", "Sports", 89.99, 120, "2023-01-20"),
        (5, "Yoga Mat", "Sports", 29.99, 300, "2023-04-05"),
        (6, "Water Bottle", "Sports", 19.99, 500, "2023-02-14"),
        (7, "Python Crash Course", "Books", 34.99, 250, "2023-05-01"),
        (8, "Data Science Handbook", "Books", 44.99, 180, "2023-06-15"),
        (9, "Coffee Maker", "Home", 59.99, 90, "2023-03-20"),
        (10, "Desk Lamp", "Home", 39.99, 160, "2023-07-01"),
        (11, "Backpack", "Accessories", 54.99, 200, "2023-04-10"),
        (12, "Sunglasses", "Accessories", 24.99, 350, "2023-08-01"),
        (13, "Smartwatch", "Electronics", 199.99, 60, "2023-09-01"),
        (14, "Bluetooth Speaker", "Electronics", 69.99, 110, "2023-10-15"),
        (15, "Notebook Set", "Office", 12.99, 400, "2023-05-20"),
        (16, "Standing Desk", "Office", 299.99, 40, "2023-11-01"),
        (17, "Plant Pot Set", "Home", 22.99, 280, "2023-06-10"),
        (18, "Fitness Tracker", "Sports", 49.99, 170, "2023-12-01"),
        (19, "Wool Scarf", "Accessories", 34.99, 220, "2024-01-10"),
        (20, "Portable Charger", "Electronics", 29.99, 300, "2024-02-01"),
    ]
    c.executemany("INSERT INTO products VALUES (?,?,?,?,?,?)", products_data)

    # -- Orders --
    c.execute("""CREATE TABLE orders (
        id INTEGER PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id),
        order_date DATE,
        total REAL,
        status TEXT
    )""")

    statuses = ["completed", "completed", "completed", "completed", "shipped", "pending", "cancelled"]
    orders = []
    for i in range(1, 501):
        cust = random.randint(1, 200)
        order_date = datetime(2023, 6, 1) + timedelta(days=random.randint(0, 600))
        status = random.choice(statuses)
        total = round(random.uniform(15, 400), 2)
        orders.append((i, cust, order_date.strftime("%Y-%m-%d"), total, status))
    c.executemany("INSERT INTO orders VALUES (?,?,?,?,?)", orders)

    # -- Order Items --
    c.execute("""CREATE TABLE order_items (
        id INTEGER PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id),
        product_id INTEGER REFERENCES products(id),
        quantity INTEGER,
        unit_price REAL
    )""")

    items = []
    item_id = 1
    for order in orders:
        n_items = random.randint(1, 4)
        prods = random.sample(range(1, 21), n_items)
        for pid in prods:
            price = products_data[pid - 1][3]
            qty = random.randint(1, 3)
            items.append((item_id, order[0], pid, qty, price))
            item_id += 1
    c.executemany("INSERT INTO order_items VALUES (?,?,?,?,?)", items)

    # -- Reviews --
    c.execute("""CREATE TABLE reviews (
        id INTEGER PRIMARY KEY,
        product_id INTEGER REFERENCES products(id),
        customer_id INTEGER REFERENCES customers(id),
        rating INTEGER,
        comment TEXT,
        review_date DATE
    )""")

    comments_good = ["Great product!", "Love it", "Excellent quality", "Highly recommend",
                     "Perfect", "Amazing value", "Best purchase ever"]
    comments_mid = ["Decent", "OK for the price", "Could be better", "Average"]
    comments_bad = ["Disappointing", "Not worth it", "Poor quality", "Would not buy again"]

    reviews = []
    for i in range(1, 301):
        pid = random.randint(1, 20)
        cid = random.randint(1, 200)
        rating = random.choices([1, 2, 3, 4, 5], weights=[5, 10, 15, 35, 35])[0]
        if rating >= 4:
            comment = random.choice(comments_good)
        elif rating == 3:
            comment = random.choice(comments_mid)
        else:
            comment = random.choice(comments_bad)
        rdate = datetime(2023, 8, 1) + timedelta(days=random.randint(0, 550))
        reviews.append((i, pid, cid, rating, comment, rdate.strftime("%Y-%m-%d")))
    c.executemany("INSERT INTO reviews VALUES (?,?,?,?,?,?)", reviews)

    conn.commit()
    conn.close()
    return DB_PATH


if __name__ == "__main__":
    path = create_demo_db()
    print(f"Demo database created: {path}")

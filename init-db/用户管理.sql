
select * from users where username  in ('admin','analyst');

delete from users where username not in ('admin','analyst');
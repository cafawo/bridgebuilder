from django.urls import path

from game import views

app_name = "game"

urlpatterns = [
    path("", views.index, name="home"),
    path("levels/random.json", views.random_level_json, name="random-level"),
    path("levels/random/<slug:seed>.json", views.random_level_json, name="random-level-legacy"),
]
